//! Online sources: where the music comes from when it is not on the disk.
//!
//! # The shape of it
//!
//! ```text
//!   the player                the registry                 the sources
//!   ---------                ---------                 ----------
//!   "play that"  ─────────▶  open_stream()
//!                            ├─ jamendo      ─┐
//!                            ├─ archive      ─┤  each one is asked, in turn,
//!                            ├─ radio        ─┤  until one delivers a byte
//!                            └─ youtube      ─┘
//!
//!   gets back:               a handle with the bytes behind it
//!   http://127.0.0.1:PORT/stream/<opaque id>
//!         │
//!         └── the local server fetches from whichever source worked,
//!             and the real address never leaves this process
//! ```
//!
//! # The rules
//!
//! - **The player never gets a remote URL.** It gets a loopback URL whose id
//!   means nothing outside this machine. The address the source used stays
//!   inside the closure that opens the stream.
//! - **Nothing is handed over before a byte has arrived.** A source that
//!   describes something it cannot deliver does not get to be believed.
//! - **A refusal is not a wobble.** A provider saying "no" is stood down
//!   for a while; a timeout is the network's problem and is not held
//!   against the source.
//! - **No remote URL is ever written to disk.** The remembered state is
//!   which source worked, and when a quarantine expires. That is all.
//!
//! # What is legal and what is not
//!
//! The open-licensed sources (Jamendo, the Internet Archive) and the radio
//! stations are unambiguous: the music is published for exactly this.
//!
//! The YouTube adapter is **opt-in and off by default**, because it works
//! through YouTube's undocumented API, which their Developer Policies
//! forbid. See [`adapters::youtube`] for the full note. The user turns it
//! on, with the trade-off in front of them.
//!
//! Spotify is a catalogue, not a source of bytes — its API says so itself.
//! It is wired up for search and artwork.

pub mod adapters;
pub mod browse;
pub mod browse_commands;
pub mod download_commands;
pub mod downloads;
pub mod auth;
pub mod spotify_commands;
pub mod yt_clients;
pub mod yt_commands;
#[cfg(test)]
mod integration_tests;
pub mod commands;
pub mod registry;
pub mod server;
pub mod types;

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use adapters::jamendo::Jamendo;
use registry::{Registry, RegistryConfig, SourceStatus};
use server::StreamServerState;
use types::{ContentId, Metadata, Source, StreamHandle};

/// The settings the user can change.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSettings {
    /// The Jamendo client id. Free, from devportal.jamendo.com.
    #[serde(default)]
    pub jamendo_client_id: Option<String>,
    /// Whether to allow the YouTube adapter. **Off by default.**
    #[serde(default)]
    pub allow_youtube: bool,
    /// Spotify.s client id, from developer.spotify.com. Spotify does not
    /// hand these out to anyone who asks.
    #[serde(default)]
    pub spotify_client_id: Option<String>,
    /// Which browser the sign-in opens. "automatic" means the first one
    /// found, and Brave is the first one looked for.
    #[serde(default)]
    pub sign_in_browser: String,
    /// How the streams are resolved: "fast" (the direct resolver, then the
    /// extractor), "fastOnly", or "extractor".
    #[serde(default)]
    pub stream_mode: String,
    /// Where the `yt-dlp` program is. `None` means "look on the PATH".
    #[serde(default)]
    pub yt_dlp_path: Option<String>,
    /// Extra arguments for `yt-dlp`, e.g. `--cookies-from-browser chrome`.
    /// The user chooses these; the app never adds them by itself.
    #[serde(default)]
    pub yt_dlp_args: Vec<String>,
}

/// The state the whole subsystem shares.
pub struct SourceState {
    pub registry: Arc<Registry>,
    pub server: Arc<StreamServerState>,
    pub settings: std::sync::RwLock<SourceSettings>,
    /// The open that is currently running, so it can be cancelled.
    ///
    /// Only one at a time: the player has one thing playing, and a second
    /// open would compete with it for the same connection.
    active: std::sync::Mutex<Option<types::CancellationToken>>,
    /// Where the settings are kept.
    settings_path: std::path::PathBuf,
    /// The app's own state folder, for the sign-in profile and the session.
    app_data_dir: std::path::PathBuf,
    /// The signed-in YouTube session, when there is one.
    pub session: std::sync::RwLock<Option<auth::session::Session>>,
    /// The Spotify tokens, when there are any.
    pub spotify_tokens: std::sync::RwLock<Option<auth::spotify::SpotifyTokens>>,
}

impl SourceState {
    /// Build the registry and start the local server.
    pub fn new(app_data_dir: std::path::PathBuf) -> Self {
        /* Two files, because two different things are written and they
         * would overwrite each other in one: the registry's memory (which
         * source worked, who is standing down) and the user's settings. */
        let state_path = app_data_dir.join("sources.json");
        let settings_path = app_data_dir.join("source-settings.json");
        let registry = Arc::new(Registry::new(
            RegistryConfig::default(),
            Some(state_path),
        ));

        /* The settings live on disk, so a Jamendo key typed once does not
         * have to be typed again every morning. */
        let settings = load_settings(&settings_path);

        let server = Arc::new(StreamServerState::default());
        let server_clone = server.clone();
        /* The server runs for the life of the app.
         *
         * `tauri::async_runtime::spawn`, not `tokio::spawn`: this runs
         * while the app is still being built, and there is no tokio
         * runtime to spawn into yet. Tauri has one of its own, and it is
         * the right one to use. */
        tauri::async_runtime::spawn(async move {
            if let Err(e) = server::serve(server_clone).await {
                eprintln!("[sources] the local stream server stopped: {e}");
            }
        });

        /* The sources are put in the registry straight away. A registry
         * with no sources in it answers every search with nothing, and
         * that looks exactly like "there is no music online". */
        let session = auth::load_session(&app_data_dir);
        let spotify_tokens = auth::spotify::load_tokens(&app_data_dir);
        build_registry_with_session(&registry, &settings, session.clone(), spotify_tokens.clone());

        Self {
            registry,
            server,
            settings: std::sync::RwLock::new(settings),
            active: std::sync::Mutex::new(None),
            settings_path,
            app_data_dir,
            session: std::sync::RwLock::new(session),
            spotify_tokens: std::sync::RwLock::new(spotify_tokens),
        }
    }

    /// The app's own state folder.
    pub fn app_data_dir(&self) -> &std::path::Path {
        &self.app_data_dir
    }

    /// The URL the player should point an audio element at.
    pub fn stream_url(&self, handle: StreamHandle) -> String {
        let id = self.server.park(handle);
        format!("{}/stream/{}", self.server.base_url(), id)
    }

    /// Cancel whatever is opening right now.
    pub fn cancel_active(&self) {
        if let Some(token) = self.active.lock().unwrap().take() {
            token.cancel();
        }
    }

    /// Change the settings, remember them, and rebuild the sources.
    pub fn set_settings(&self, settings: SourceSettings) {
        *self.settings.write().unwrap() = settings.clone();
        save_settings(&self.settings_path, &settings);
        /* The registry's memory — which source worked, who is
         * quarantined — is deliberately kept. */
        build_registry_with_session(
            &self.registry,
            &settings,
            self.session.read().unwrap().clone(),
            self.spotify_tokens.read().unwrap().clone(),
        );
    }

    /// Keep a signed-in YouTube session, and hand it to the sources.
    pub fn set_session(&self, session: auth::session::Session) -> crate::sources::yt_commands::SignInStatus {
        let status = crate::sources::yt_commands::SignInStatus {
            account_name: session.account_name.clone(),
            email: session.email.clone(),
            premium: session.premium,
            signed_in: true,
            channel_id: session.channel_id.clone(),
            ..Default::default()
        };
        /* Keep it on disk, so the app is still signed in tomorrow. */
        let _ = auth::save_session(&self.app_data_dir, &session);
        *self.session.write().unwrap() = Some(session.clone());

        /* And hand it to the sources, so the YouTube adapter searches as
         * the account rather than as a stranger. */
        let settings = self.settings.read().unwrap().clone();
        build_registry_with_session(
            &self.registry,
            &settings,
            Some(session),
            self.spotify_tokens.read().unwrap().clone(),
        );
        status
    }

    /// Forget the session.
    pub fn clear_session(&self) {
        *self.session.write().unwrap() = None;
        auth::forget_session(&self.app_data_dir);
        let settings = self.settings.read().unwrap().clone();
        build_registry_with_session(
            &self.registry,
            &settings,
            None,
            self.spotify_tokens.read().unwrap().clone(),
        );
    }

    /// How the session stands.
    pub fn session_status(&self, waiting: bool) -> crate::sources::yt_commands::SignInStatus {
        let session = self.session.read().unwrap();
        match session.as_ref() {
            Some(session) if session.is_signed_in() => crate::sources::yt_commands::SignInStatus {
                waiting,
                account_name: session.account_name.clone(),
                email: session.email.clone(),
                premium: session.premium,
                signed_in: true,
                channel_id: session.channel_id.clone(),
                ..Default::default()
            },
            _ => crate::sources::yt_commands::SignInStatus {
                waiting,
                ..Default::default()
            },
        }
    }
}

/// Read the settings from disk.
fn load_settings(path: &std::path::Path) -> SourceSettings {
    let Ok(bytes) = std::fs::read(path) else {
        return SourceSettings::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Write the settings to disk.
///
/// The settings are the user's — a Jamendo key, and the fact that they
/// said yes to YouTube. Neither is a secret in the "must never be on
/// disk" sense: a Jamendo client id is a public identifier, and the
/// opt-in flag is a preference. But a file next to the app's other state
/// is where the user expects to find it.
fn save_settings(path: &std::path::Path, settings: &SourceSettings) {
    let Ok(json) = serde_json::to_vec_pretty(settings) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, json);
}

/// Rebuild the source list, with a signed-in YouTube session.
///
/// The session is what turns the YouTube adapter from "searches like a
/// stranger" into "searches like the account".
pub fn build_registry_with_session(
    registry: &Registry,
    settings: &SourceSettings,
    session: Option<auth::session::Session>,
    spotify_tokens: Option<auth::spotify::SpotifyTokens>,
) {
    let mut sources = registry.lock_sources();
    sources.clear();

    sources.push(Arc::new(Jamendo::new(settings.jamendo_client_id.clone())) as Arc<dyn Source>);
    sources.push(Arc::new(adapters::archive::Archive::new()) as Arc<dyn Source>);
    sources.push(Arc::new(adapters::radio::Radio::new()) as Arc<dyn Source>);
    /* Spotify is a catalogue, not a source of bytes, so it is always
     * registered: it can search, and it says plainly that it cannot play.
     * It reports itself as unconfigured until the user signs in. */
    sources.push(Arc::new(adapters::spotify::Spotify::new(
        spotify_tokens.clone(),
        settings.spotify_client_id.clone(),
    )) as Arc<dyn Source>);

    if settings.allow_youtube {
        let program = settings
            .yt_dlp_path
            .clone()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from("yt-dlp"));
        sources.push(Arc::new(adapters::youtube::YouTube::new(
            program,
            settings.yt_dlp_args.clone(),
            session,
            adapters::youtube::StreamMode::from_str(&settings.stream_mode),
        )) as Arc<dyn Source>);
    }
    drop(sources);

    /* Make sure every source has an entry in the memory, so the settings
     * screen shows them all. */
    let mut memory = registry.lock_memory();
    for source in registry.sources() {
        memory.entry(source.id().to_string()).or_default();
    }
}

/// A search result, as the player sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub metadata: Metadata,
    /// The provider's id, as `provider:external-id`.
    pub content_id: String,
    /// The provider's name.
    pub provider: String,
    /// Whether this provider can actually play what it found.
    ///
    /// Spotify is the case that matters: it finds the track beautifully and
    /// cannot play a byte of it. Saying so up front is better than letting
    /// the user press play and wait.
    pub playable: bool,
    /// Why it cannot, when it cannot.
    pub note: Option<String>,
}

/// The state of the whole subsystem, for the settings screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesStatus {
    pub sources: Vec<SourceStatus>,
    /// The loopback base URL. This is NOT a remote address; it is the
    /// player's own machine.
    pub base_url: String,
    pub settings: SourceSettings,
}

/// Search one source.
pub async fn search_source(
    registry: &Registry,
    provider: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<SearchResult>, String> {
    let source = registry
        .sources()
        .into_iter()
        .find(|s| s.id() == provider)
        .ok_or_else(|| format!("no source called {provider}"))?;

    if !source.is_configured() {
        return Err(source
            .not_configured_reason()
            .unwrap_or_else(|| "this source is not set up".into()));
    }

    let found = source
        .search(query, limit)
        .await
        .map_err(|e| e.to_string())?;

    let playable = provider != "spotify";
    Ok(found
        .into_iter()
        .map(|(metadata, content_id)| SearchResult {
            metadata,
            content_id: content_id.to_string(),
            provider: provider.to_string(),
            playable,
            note: if playable {
                None
            } else {
                Some("Spotify's API is a catalogue, not a source of audio".into())
            },
        })
        .collect())
}

/// Search every source that can search, and merge the results.
///
/// The playable ones come first: they are the ones the user can actually
/// press.
pub async fn search_all(
    registry: &Registry,
    query: &str,
    limit: u32,
) -> Vec<SearchResult> {
    let mut out = Vec::new();
    for source in registry.sources() {
        if !source.is_configured() {
            continue;
        }
        if let Ok(results) = source.search(query, limit).await {
            for (metadata, content_id) in results {
                let playable = source.id() != "spotify";
                out.push(SearchResult {
                    metadata,
                    content_id: content_id.to_string(),
                    provider: source.id().to_string(),
                    playable,
                    note: if playable {
                        None
                    } else {
                        Some("Spotify's API is a catalogue, not a source of audio".into())
                    },
                });
            }
        }
    }
    out
}

/// Open a stream to some content, and hand the player a local URL for it.
///
/// This is the whole point of the subsystem in one function: the player
/// asked for a track by name, and gets back something it can point an audio
/// element at — without ever seeing where the bytes come from.
pub async fn play(state: &SourceState, content_id: &str) -> Result<String, String> {
    let content = parse_content_id(content_id)?;
    let token = types::CancellationToken::new();
    *state.active.lock().unwrap() = Some(token.clone());
    let handle = state
        .registry
        .open_stream(&content, &token)
        .await
        .map_err(|e| e.to_string())?;
    *state.active.lock().unwrap() = None;
    Ok(state.stream_url(handle))
}

/// Parse `provider:external-id` back into a content id.
fn parse_content_id(text: &str) -> Result<ContentId, String> {
    let (provider, external) = text
        .split_once(':')
        .ok_or_else(|| "that is not a content id".to_string())?;
    if provider.is_empty() || external.is_empty() {
        return Err("that is not a content id".into());
    }
    Ok(ContentId::new(provider, external))
}

/// Milliseconds since the epoch, for the health results.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Re-exported so the command layer does not have to reach into `types`.

pub use types::HealthResult as SourceHealthResult;
