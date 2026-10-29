//! The commands for signing in to YouTube Music.
//!
//! The flow the user goes through:
//!
//! 1. Press **sign in**. A browser opens with a profile of its own.
//! 2. Sign in to YouTube Music in that browser, the normal way.
//! 3. Come back and press **done**.
//! 4. The app asks the browser for its YouTube cookies, works out which
//!    login is the one to use, and keeps the session.
//!
//! Nothing is typed on the user's behalf, no credential passes through the
//! app, and the browser's everyday profile is never opened.

use std::sync::Arc;

use tauri::State;

use super::auth::innertube::InnerTube;
use super::auth::{self};
use super::SourceState;

/// What the sign-in is doing right now.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInStatus {
    /// Whether a browser is open and waiting.
    pub waiting: bool,
    /// The account the session belongs to.
    pub account_name: Option<String>,
    pub email: Option<String>,
    /// Whether the account has YouTube Music Premium — the thing that
    /// decides whether the streams are ad-free.
    pub premium: Option<bool>,
    /// Whether there is a session at all.
    pub signed_in: bool,
    /// The account's channel, for the settings screen.
    pub channel_id: Option<String>,
    /// Where the sign-in profile lives, while a sign-in is in progress.
    ///
    /// The user is told this: the profile is theirs, it is where the
    /// cookies live, and it is what `yt-dlp` can be pointed at.
    pub profile_path: Option<String>,
}

/// The sign-in that is in progress, if there is one.
#[derive(Default)]
pub struct SignInState {
    /// The browser, waiting for the user.
    pub current: std::sync::Mutex<Option<Arc<auth::SignIn>>>,
}

/// Start the sign-in: open a browser with a profile of its own.
///
/// The browser stays open while the user signs in. The app is told when
/// they are done.
#[tauri::command]
pub async fn youtube_sign_in_start(
    state: State<'_, SourceState>,
    sign_in: State<'_, SignInState>,
) -> Result<SignInStatus, String> {
    /* Only one at a time — two browsers waiting for the same user is
     * just confusing. */
    {
        let mut current = sign_in.current.lock().unwrap();
        if let Some(existing) = current.as_ref() {
            existing.close();
        }
        *current = None;
    }

    let choice = state.settings.read().unwrap().sign_in_browser.clone();
    let started = auth::SignIn::start(
        state.app_data_dir(),
        auth::browser::BrowserChoice::from_str(&choice),
    )
    .await?;
    let profile_path = started.profile.to_string_lossy().to_string();
    *sign_in.current.lock().unwrap() = Some(Arc::new(started));
    Ok(SignInStatus {
        waiting: true,
        profile_path: Some(profile_path),
        ..Default::default()
    })
}

/// The user says they are done. Collect the cookies and build the session.
#[tauri::command]
pub async fn youtube_sign_in_finish(
    state: State<'_, SourceState>,
    sign_in: State<'_, SignInState>,
) -> Result<SignInStatus, String> {
    let current = sign_in.current.lock().unwrap().clone();
    let Some(current) = current else {
        return Err("there is no sign-in in progress".into());
    };

    let session = current.collect().await?;
    /* Work out which login this is, and whether it is Premium. */
    let session = auth::complete_session(session).await;

    /* Close the browser — the session is in the app now. */
    current.close();
    *sign_in.current.lock().unwrap() = None;

    /* Keep it, and hand it to the sources. */
    let status = state.set_session(session);

    Ok(SignInStatus {
        account_name: status.account_name,
        email: status.email,
        premium: status.premium,
        signed_in: true,
        channel_id: status.channel_id,
        ..status
    })
}

/// The sign-in, abandoned. The browser is closed and nothing is kept.
#[tauri::command]
pub fn youtube_sign_in_cancel(
    state: State<'_, SourceState>,
    sign_in: State<'_, SignInState>,
) -> SignInStatus {
    let current = sign_in.current.lock().unwrap().take();
    if let Some(current) = current {
        current.close();
    }
    state.clear_session();
    SignInStatus::default()
}

/// How the sign-in stands right now.
#[tauri::command]
pub fn youtube_sign_in_status(
    state: State<'_, SourceState>,
    sign_in: State<'_, SignInState>,
) -> SignInStatus {
    let current = sign_in.current.lock().unwrap().clone();
    let waiting = current.is_some();
    let profile_path = current.map(|c| c.profile.to_string_lossy().to_string());
    let mut status = state.session_status(waiting);
    status.profile_path = profile_path;
    status
}

/// Sign out: forget the session and close the browser.
#[tauri::command]
pub fn youtube_sign_out(
    state: State<'_, SourceState>,
    sign_in: State<'_, SignInState>,
) -> SignInStatus {
    let current = sign_in.current.lock().unwrap().take();
    if let Some(current) = current {
        current.close();
    }
    state.clear_session();
    SignInStatus::default()
}

/// The account's own library, from YouTube Music itself.
///
/// This is the signed-in part: the library, the playlists and the likes
/// only exist for an account, and they are fetched with the session's
/// signature.
#[tauri::command]
pub async fn youtube_library(
    section: Option<String>,
    state: State<'_, SourceState>,
) -> Result<Browse, String> {
    let session = state
        .session
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "not signed in to YouTube Music".to_string())?;
    let inner = InnerTube::new(Some(session));
    let section = section.unwrap_or_else(|| "FEmusic_liked_videos".to_string());
    let response = inner.library(&section).await.map_err(|e| e.to_string())?;
    Ok(super::adapters::youtube::parse_browse(&response, 200))
}

/// One of the account's playlists, from YouTube Music itself.
#[tauri::command]
pub async fn youtube_playlist(
    playlist_id: String,
    state: State<'_, SourceState>,
) -> Result<Browse, String> {
    let session = state
        .session
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "not signed in to YouTube Music".to_string())?;
    let inner = InnerTube::new(Some(session));
    let response = inner.playlist(&playlist_id).await.map_err(|e| e.to_string())?;
    Ok(super::adapters::youtube::parse_browse(&response, 500))
}

/// The account's playlists, by name.
#[tauri::command]
pub async fn youtube_playlists(
    state: State<'_, SourceState>,
) -> Result<Browse, String> {
    let session = state
        .session
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "not signed in to YouTube Music".to_string())?;
    let inner = InnerTube::new(Some(session));
    let response = inner.library("FEmusic_liked_playlists").await.map_err(|e| e.to_string())?;
    Ok(super::adapters::youtube::parse_browse(&response, 200))
}

/// Write the session's cookies out as a `cookies.txt` for `yt-dlp`.
///
/// This is what lets the user point `yt-dlp` at the sign-in profile the
/// app made, so the stream resolution uses the same session.
#[tauri::command]
pub async fn youtube_export_cookies(
    state: State<'_, SourceState>,
) -> Result<String, String> {
    let session = state
        .session
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "not signed in to YouTube Music".to_string())?;
    let path = state.app_data_dir().join("yt-cookies.txt");
    let text = auth::as_cookies_txt(&session.cookies);
    std::fs::write(&path, text).map_err(|e| format!("could not write the cookies: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// What YouTube thinks of a track, and whether it can be played.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork_url: Option<String>,
    pub duration_secs: Option<u64>,
    /// Whether the account may play it.
    pub playable: bool,
    /// Why not, when it may not.
    pub reason: Option<String>,
    /// The best audio bitrate on offer, in kbps.
    pub best_kbps: Option<u32>,
    /// Whether the account has YouTube Music Premium — the thing that
    /// decides whether the streams carry adverts.
    pub premium: Option<bool>,
}

/// Ask YouTube about a track: what it is, and whether it can be played.
///
/// The `player` request is the one that has to be signed properly, and
/// the one that decides whether the audio can be fetched at all. The
/// reason it says — "sign in", "members only", "not in your country" —
/// is worth showing, because it is the difference between "this source
/// is broken" and "this one video cannot be played".
#[tauri::command]
pub async fn youtube_track_info(
    video_id: String,
    state: State<'_, SourceState>,
) -> Result<TrackInfo, String> {
    let session = state.session.read().unwrap().clone();
    let inner = InnerTube::new(session);

    /* The title and the channel, from the "what comes next" answer. */
    let mut info = TrackInfo::default();
    if let Ok(next) = inner.next(&video_id).await {
        if let Some(renderer) = next
            .get("contents")
            .and_then(|c| c.get("singleColumnMusicWatchNextResultsRenderer"))
            .and_then(|s| s.get("tabs"))
            .and_then(|t| t.as_array())
            .and_then(|t| t.first())
            .and_then(|t| t.get("tabRenderer"))
            .and_then(|t| t.get("content"))
            .and_then(|c| c.get("sectionListRenderer"))
            .and_then(|s| s.get("contents"))
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("musicWatchNextResultsRenderer"))
        {
            info.title = renderer
                .get("title")
                .and_then(|t| t.get("runs"))
                .and_then(|r| r.as_array())
                .and_then(|r| r.first())
                .and_then(|r| r.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string();
            info.artist = renderer
                .get("byline")
                .and_then(|b| b.get("runs"))
                .and_then(|r| r.as_array())
                .and_then(|r| r.first())
                .and_then(|r| r.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string();
        }
    }

    /* And whether it can be played, and how good the audio is. */
    match inner.player(&video_id).await {
        Ok(player) => {
            let status = player
                .get("playabilityStatus")
                .and_then(|s| s.get("status"))
                .and_then(|s| s.as_str())
                .unwrap_or("UNKNOWN");
            info.playable = status == "OK";
            if !info.playable {
                let reason = player
                    .get("playabilityStatus")
                    .and_then(|s| s.get("reason"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("YouTube would not say why");
                info.reason = Some(reason.to_string());
            }
            /* The best audio on offer, so the settings can say what the
             * user is going to get. */
            if let Some(formats) = player
                .get("streamingData")
                .and_then(|s| s.get("adaptiveFormats"))
                .and_then(|f| f.as_array())
            {
                info.best_kbps = formats
                    .iter()
                    .filter(|f| {
                        f.get("hasAudio")
                            .and_then(|h| h.as_bool())
                            .unwrap_or(false)
                            && !f
                                .get("hasVideo")
                                .and_then(|h| h.as_bool())
                                .unwrap_or(false)
                    })
                    .filter_map(|f| f.get("bitrate").and_then(|b| b.as_u64()))
                    .max()
                    .map(|b| (b / 1000) as u32);
            }
        }
        Err(e) => {
            info.playable = false;
            info.reason = Some(e.to_string());
        }
    }

    /* And whether the account is Premium — the thing that decides
     * whether the streams carry adverts. */
    if let Some(session) = state.session.read().unwrap().as_ref() {
        info.premium = session.premium;
    }

    Ok(info)
}
/// The ways the streams can be resolved, for the settings screen.
#[tauri::command]
pub fn youtube_stream_modes() -> Vec<(String, String)> {
    crate::sources::adapters::youtube::StreamMode::all()
        .iter()
        .map(|mode| (mode.as_str().to_string(), mode.label().to_string()))
        .collect()
}

/// The library sections, for the UI.
#[tauri::command]
pub fn youtube_library_sections() -> Vec<(String, String)> {
    super::auth::innertube::LIBRARY_SECTIONS
        .iter()
        .map(|(id, name)| (id.to_string(), name.to_string()))
        .collect()
}

/// Download a track to a file.
///
/// The download is done by `yt-dlp`, which solves the cipher and the token
/// that the player request needs. The session's cookies are handed to it
/// as a file, so it fetches exactly what the account can fetch — which is
/// what makes a Premium account's downloads the good ones.
///
/// The file is written to the user's downloads folder, with the audio
/// only, as an M4A — the format YouTube Music itself serves.
#[tauri::command]
pub async fn youtube_download(
    video_id: String,
    state: State<'_, SourceState>,
) -> Result<String, String> {
    let session = state
        .session
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "not signed in to YouTube Music".to_string())?;

    let settings = state.settings.read().unwrap().clone();
    let program = settings
        .yt_dlp_path
        .clone()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("yt-dlp"));

    /* The cookies, written where `yt-dlp` can be pointed at them. */
    let cookies = state.app_data_dir().join("yt-cookies.txt");
    std::fs::write(&cookies, auth::as_cookies_txt(&session.cookies))
        .map_err(|e| format!("could not write the cookies: {e}"))?;

    let target = state
        .app_data_dir()
        .join("downloads")
        .join(format!("{video_id}.m4a"));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not make the folder: {e}"))?;
    }

    let output = tokio::process::Command::new(&program)
        .arg("--no-warnings")
        .arg("--ignore-config")
        .arg("--no-playlist")
        .arg("--extract-audio")
        .arg("--audio-format")
        .arg("m4a")
        .arg("--cookies")
        .arg(&cookies)
        .arg("--output")
        .arg(&target)
        .arg(format!("https://www.youtube.com/watch?v={video_id}"))
        .output()
        .await
        .map_err(|e| format!("could not run yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("the download failed")
            .to_string();
        return Err(message);
    }

    /* `yt-dlp` may have changed the extension on the way. */
    for candidate in [
        target.clone(),
        target.with_extension("m4a"),
        target.with_extension("mp3"),
    ] {
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }
    Err("the download finished but the file was not where it should be".into())
}

/// What a browse came back with: the tracks in it, and the cards.
///
/// A card is an album, an artist or a playlist. It is not a track and
/// cannot be played — it is something to OPEN, which then lists the
/// things inside it. Mixing the two is what makes a row that looks
/// playable and then is not.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Browse {
    pub tracks: Vec<LibraryItem>,
    pub cards: Vec<LibraryCard>,
}

/// One card — an album, an artist, a playlist.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCard {
    /// The id to open it with.
    pub browse_id: String,
    /// ALBUM, ARTIST, PLAYLIST.
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub artwork_url: Option<String>,
}

/// One thing from the account's library or a playlist.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    /// The video id — the thing YouTube calls a video even when it is a
    /// song.
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: Option<u64>,
    pub artwork_url: Option<String>,
}

impl From<super::auth::innertube::SearchHit> for LibraryItem {
    fn from(hit: super::auth::innertube::SearchHit) -> Self {
        Self {
            video_id: hit.video_id,
            title: hit.title,
            artist: hit.artist,
            album: hit.album,
            duration_secs: hit.duration_secs,
            artwork_url: hit.artwork_url,
        }
    }
}
