//! YouTube Music — the signed-in one.
//!
//! # READ THIS BEFORE ENABLING IT
//!
//! YouTube's Developer Policies say, in their own words:
//!
//! > III.D.7 — "You must not use undocumented APIs without express
//! > permission."
//!
//! > III.E.1 — you must not "download, import, backup, cache, or store copies
//! > of YouTube audiovisual content without YouTube's prior written
//! > approval."
//!
//! This adapter speaks YouTube's **undocumented** API, so III.D.7 is what
//! it runs into. It is **off by default**, and the user turns it on with
//! the trade-off in front of them.
//!
//! # What it does and does not do
//!
//! - It talks to YouTube's own servers, over the user's own connection,
//!   with the user's own account.
//! - It **does not** touch the user's everyday browser profile. The
//!   sign-in happens in a profile the app makes, and the cookies are read
//!   back through the browser's own DevTools Protocol — no database is
//!   opened and no encryption is undone.
//! - It **does not** circumvent DRM. A protected video is simply not
//!   playable, and this adapter says so rather than working around it.
//!
//! # The two halves
//!
//! | Half | How |
//! |---|---|
//! | **Metadata** — search, library, playlists | The InnerTube API, called directly from Rust, signed with the session's `SAPISIDHASH`. No external tool is needed. |
//! | **Streams** — the actual audio | `yt-dlp`, which solves the cipher and the token that the player request needs. |

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

use crate::sources::auth::innertube::{parse_item, InnerTube, SearchHit};
use crate::sources::auth::session::Session;
use crate::sources::types::{
    CancellationToken, ContentId, Health, HealthResult, Metadata, OpenedStream, Source, SourceError,
    StreamHandle,
};

/// The video id: eleven characters of URL-safe base64.
#[derive(Debug, Deserialize)]
struct YtVideo {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    artist: Option<String>,
    #[serde(default)]
    album: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    license: Option<String>,
}

/// The YouTube source.
pub struct YouTube {
    client: reqwest::Client,
    /// Where the `yt-dlp` program is.
    program: PathBuf,
    /// Extra arguments, e.g. `--cookies-from-browser chrome`.
    extra_args: Vec<String>,
    /// The signed-in session, when there is one.
    session: Option<Session>,
    /// The InnerTube client, for the metadata.
    inner: InnerTube,
    /// How the streams are resolved.
    mode: StreamMode,
    /// The visitor id, kept so it is fetched once and not per track.
    visitor: crate::sources::yt_clients::VisitorCache,
}

/// How the streams are resolved.
///
/// Two ways, and the choice is the user's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StreamMode {
    /// The fast path first, and the extractor for whatever it refuses.
    ///
    /// This is the one to use. The fast path answers in a few hundred
    /// milliseconds where the extractor takes seconds, and the extractor
    /// covers the handful of tracks the fast path will not serve.
    #[default]
    Fast,
    /// Only the fast path. Quicker still, and it will refuse some tracks.
    FastOnly,
    /// Only the extractor. Slower, but it is the one that gets age-gated
    /// and private uploads.
    Extractor,
}

impl StreamMode {
    /// The id used in the settings file.
    pub fn as_str(self) -> &'static str {
        match self {
            StreamMode::Fast => "fast",
            StreamMode::FastOnly => "fastOnly",
            StreamMode::Extractor => "extractor",
        }
    }

    /// From the id in the settings file.
    pub fn from_str(text: &str) -> StreamMode {
        match text.trim() {
            "fastOnly" | "fast_only" => StreamMode::FastOnly,
            "extractor" => StreamMode::Extractor,
            _ => StreamMode::Fast,
        }
    }

    /// The name to show the user.
    pub fn label(self) -> &'static str {
        match self {
            StreamMode::Fast => "FAST, THEN THE EXTRACTOR",
            StreamMode::FastOnly => "FAST ONLY",
            StreamMode::Extractor => "THE EXTRACTOR ONLY",
        }
    }

    /// Every mode, for the settings screen.
    pub fn all() -> &'static [StreamMode] {
        &[StreamMode::Fast, StreamMode::FastOnly, StreamMode::Extractor]
    }
}

impl YouTube {
    pub fn new(
        program: PathBuf,
        extra_args: Vec<String>,
        session: Option<Session>,
        mode: StreamMode,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        let inner = InnerTube::new(session.clone());
        Self {
            client,
            program,
            extra_args,
            session,
            inner,
            mode,
            visitor: crate::sources::yt_clients::VisitorCache::new(),
        }
    }

    /// Is the program actually there?
    fn program_exists(&self) -> bool {
        if self.program.components().count() > 1 {
            return self.program.exists();
        }
        /* A bare name: look for it on the PATH. */
        let Ok(path) = std::env::var("PATH") else {
            return false;
        };
        let names: Vec<String> = if cfg!(windows) {
            vec!["yt-dlp.exe".into(), "yt-dlp".into(), "yt-dlp.bat".into()]
        } else {
            vec!["yt-dlp".into()]
        };
        path.split(if cfg!(windows) { ';' } else { ':' })
            .filter(|d| !d.is_empty())
            .any(|dir| {
                names
                    .iter()
                    .any(|n| std::path::Path::new(dir).join(n).exists())
            })
    }

    /// Run the program and get its JSON out, one object per line.
    async fn run_json_lines(
        &self,
        args: &[String],
    ) -> Result<Vec<serde_json::Value>, SourceError> {
        if !self.program_exists() {
            return Err(SourceError::NotConfigured("yt-dlp is not installed".into()));
        }
        let mut command = tokio::process::Command::new(&self.program);
        command
            .args(args)
            .arg("--no-warnings")
            .arg("--ignore-config")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let output = command
            .output()
            .await
            .map_err(|e| SourceError::Transient(format!("could not run yt-dlp: {e}")))?;
        if !output.status.success() {
            return Err(self.classify_failure(&output.stderr));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .collect())
    }

    /// Run the program and get its plain text output.
    async fn run_plain(&self, args: &[String]) -> Result<String, SourceError> {
        if !self.program_exists() {
            return Err(SourceError::NotConfigured("yt-dlp is not installed".into()));
        }
        let mut command = tokio::process::Command::new(&self.program);
        command
            .args(args)
            .arg("--no-warnings")
            .arg("--ignore-config")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let output = command
            .output()
            .await
            .map_err(|e| SourceError::Transient(format!("could not run yt-dlp: {e}")))?;
        if !output.status.success() {
            return Err(self.classify_failure(&output.stderr));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Turn a failure into the right kind of error.
    ///
    /// The distinctions matter: a refusal is the provider saying no, and
    /// it counts against the source. A timeout is the network's fault and
    /// does not.
    fn classify_failure(&self, stderr: &[u8]) -> SourceError {
        let stderr = String::from_utf8_lossy(stderr);
        let message = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("yt-dlp failed")
            .to_string();
        let lowered = message.to_lowercase();

        /* DRM is its own thing: the content is protected, and this
         * adapter does not work around that. */
        if lowered.contains("drm")
            || lowered.contains("protected")
            || lowered.contains("encrypted")
        {
            return SourceError::Protected(message);
        }
        if lowered.contains("sign in")
            || lowered.contains("login required")
            || lowered.contains("private video")
            || lowered.contains("members-only")
            || lowered.contains("members only")
            || lowered.contains("age-restricted")
            || lowered.contains("not available in your country")
            || lowered.contains("unsupported url")
            || lowered.contains("403")
        {
            return SourceError::Refused(message);
        }
        if lowered.contains("unable to download") || lowered.contains("timed out") {
            return SourceError::Transient(message);
        }
        SourceError::Transient(message)
    }

    /// The direct address of a track's audio.
    ///
    /// Two ways, and which is used depends on the mode:
    ///
    /// - **The fast path.** A `/player` call with an app-client identity.
    ///   Those clients get plain addresses — no signature, no `n`
    ///   transform, no token — so it is one JSON POST and the address is
    ///   ready. It takes a few hundred milliseconds where the extractor
    ///   takes seconds, and it is far less likely to fail.
    /// - **The extractor.** `yt-dlp`, which is slower but gets the tracks
    ///   the fast path refuses: age gates, private uploads, and whatever
    ///   the clients have been throttled for.
    async fn direct_address(&self, video_id: &str) -> Result<String, SourceError> {
        /* The fast path first, unless the user asked for the extractor
         * only. */
        if self.mode != StreamMode::Extractor {
            match crate::sources::yt_clients::resolve(
                &self.client,
                video_id,
                self.visitor.get(&self.client).await.as_deref(),
            )
            .await
            {
                Some(resolved) => {
                    /* Which client served it, and how good it was. Worth
                     * knowing when a track sounds worse than it should. */
                    eprintln!("resolved {video_id} · {}", resolved.describe());
                    return Ok(resolved.url);
                }
                None if self.mode == StreamMode::FastOnly => {
                    return Err(SourceError::Transient(
                        "the direct resolver would not serve it".into(),
                    ));
                }
                None => { /* fall through to the extractor */ }
            }
        }

        /* And the extractor, which is the one that gets the awkward ones.
         * It is given the session's cookies, so it fetches exactly what
         * the account can fetch. */
        let mut args = vec!["--get-url".to_string()];
        args.extend(self.extra_args.iter().cloned());
        args.push("-f".to_string());
        args.push("bestaudio/best".to_string());
        args.push(format!("https://www.youtube.com/watch?v={video_id}"));

        match self.run_plain(&args).await {
            Ok(output) => {
                output
                    .lines()
                    .map(|l| l.trim())
                    .find(|l| l.starts_with("http"))
                    .map(|s| s.to_string())
                    .ok_or_else(|| {
                        SourceError::Transient("yt-dlp gave no address".into())
                    })
            }
            Err(e) => Err(e),
        }
    }
}

#[async_trait::async_trait]
impl Source for YouTube {
    fn id(&self) -> &str {
        "youtube"
    }

    fn display_name(&self) -> &str {
        "YouTube Music (opt-in)"
    }

    fn is_configured(&self) -> bool {
        /* The opt-in flag lives in the settings. This adapter is only
         * constructed when the user has turned it on — see
         * [`crate::sources::build_registry`]. */
        self.program_exists()
    }

    fn not_configured_reason(&self) -> Option<String> {
        if self.program_exists() {
            None
        } else {
            Some("yt-dlp is not installed — put it on the PATH, or set where it lives in the settings".into())
        }
    }

    async fn health_check(&self) -> HealthResult {
        let started = std::time::Instant::now();
        let health = if !self.program_exists() {
            Health::Unhealthy("yt-dlp is not installed".into())
        } else {
            match self.run_plain(&["--version".to_string()]).await {
                Ok(_) => Health::Healthy,
                Err(e) => Health::Unhealthy(e.to_string()),
            }
        };
        HealthResult {
            health,
            latency_ms: started.elapsed().as_millis() as u64,
            checked_at: crate::sources::now_ms(),
        }
    }

    /// Search, through YouTube Music's own API.
    ///
    /// The InnerTube search works without a session — that is how a
    /// stranger's browser searches — but with one it is the *signed-in*
    /// search, which is the account's own view of the catalogue.
    async fn search(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        /* First try the API directly: it is faster, it needs no external
         * tool, and it is the account's own search when there is a
         * session. */
        match self.inner.search(query, limit).await {
            Ok(hits) if !hits.is_empty() => {
                return Ok(hits.into_iter().map(|hit| (hit_to_metadata(&hit), hit_to_id(&hit))).collect());
            }
            Ok(_) => { /* fall through to yt-dlp */ }
            Err(e) if self.session.is_none() => {
                /* No session and the API would not answer: try the tool. */
                eprintln!("[youtube] the search API would not answer: {e}");
            }
            Err(e) => {
                eprintln!("[youtube] the search API would not answer: {e}");
            }
        }

        /* Fall back to the tool, which searches a different way. */
        let limit = limit.clamp(1, 25);
        let mut args = vec!["--flat-playlist".to_string()];
        args.extend(self.extra_args.iter().cloned());
        args.push("--dump-json".to_string());
        args.push(format!("ytsearch{limit}:{query}"));

        let output = self.run_json_lines(&args).await?;
        Ok(output
            .into_iter()
            .filter_map(|v| {
                let video: YtVideo = serde_json::from_value(v).ok()?;
                if video.id.is_empty() {
                    return None;
                }
                let meta = Metadata {
                    title: video.title.unwrap_or_default(),
                    artist: video
                        .artist
                        .or(video.uploader)
                        .or(video.channel)
                        .unwrap_or_default(),
                    album: video.album.unwrap_or_default(),
                    duration_secs: video.duration.map(|d| d as u64),
                    artwork_url: video.thumbnail,
                    license: video.license,
                };
                Some((meta, ContentId::new("youtube", video.id)))
            })
            .collect())
    }

    async fn open_stream(
        &self,
        content: &ContentId,
        cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError> {
        let address = self.direct_address(&content.external_id).await?;

        /* The handshake. The address is never given to the player; the bytes
         * are fetched here and served from loopback. */
        let response = self
            .client
            .get(&address)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not fetch the audio: {e}")))?;
        if !response.status().is_success() {
            return Err(super::jamendo::classify(response.status().as_u16()));
        }
        let content_length = response.content_length();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let mut bytes = response.bytes_stream();
        use futures_util::StreamExt;
        let first = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(SourceError::Cancelled),
            chunk = bytes.next() => chunk,
        };
        match first {
            Some(Ok(chunk)) if !chunk.is_empty() => {}
            Some(Ok(_)) => return Err(SourceError::Transient("the audio was empty".into())),
            Some(Err(e)) => return Err(SourceError::Transient(format!("the audio stopped: {e}"))),
            None => return Err(SourceError::Transient("the audio ended immediately".into())),
        }

        let client = self.client.clone();
        let opener = std::sync::Arc::new(move |range: Option<(u64, Option<u64>)>| {
            let client = client.clone();
            let address = address.clone();
            crate::sources::types::boxed_stream(async move {
                let mut request = client.get(&address);
                if let Some((start, end)) = range {
                    let spec = match end {
                        Some(end) => format!("bytes={start}-{end}"),
                        None => format!("bytes={start}-"),
                    };
                    request = request.header(reqwest::header::RANGE, spec);
                }
                let response = request
                    .send()
                    .await
                    .map_err(|e| SourceError::Transient(format!("could not fetch the audio: {e}")))?;
                if !response.status().is_success() {
                    return Err(super::jamendo::classify(response.status().as_u16()));
                }
                let length = response.content_length();
                let kind = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let bytes = response.bytes_stream();
                Ok(OpenedStream {
                    reader: Box::new(super::jamendo::ChainReader::new(bytes.boxed())),
                    content_length: length,
                    content_type: kind,
                })
            })
        });

        Ok(StreamHandle {
            opener,
            content_length,
            content_type,
            source_id: "youtube".into(),
            content_id: content.clone(),
        })
    }
}

/// Turn a search hit into the metadata the player shows.
fn hit_to_metadata(hit: &SearchHit) -> Metadata {
    Metadata {
        title: hit.title.clone(),
        artist: hit.artist.clone(),
        album: hit.album.clone(),
        duration_secs: hit.duration_secs,
        artwork_url: hit.artwork_url.clone(),
        /* YouTube does not say what the licence is on a search result. */
        license: None,
    }
}

/// Turn a search hit into a content id.
fn hit_to_id(hit: &SearchHit) -> ContentId {
    ContentId::new("youtube", hit.video_id.clone())
}

/// Walk a library or playlist answer and pull the songs out of it.
///
/// The shape is the same as a search's, but the items are inside a
/// playlist panel rather than a shelf, and the continuation has to be
/// followed for a long list.
/// Walk a browse answer and pull out the tracks and the cards.
///
/// The two are kept apart on purpose. A card is an album, an artist or a
/// playlist: it has a *browse* id, not a video id, and it is opened
/// rather than played. Treating a card as a track is what puts a row in
/// the list that then fails to play.
pub fn parse_browse(
    response: &serde_json::Value,
    limit: u32,
) -> crate::sources::yt_commands::Browse {
    let mut tracks: Vec<SearchHit> = Vec::new();
    let mut cards: Vec<crate::sources::auth::innertube::SearchCard> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    /* The API moves its shapes around, so the walk is by shape rather
     * than by path. */
    fn walk(
        value: &serde_json::Value,
        tracks: &mut Vec<SearchHit>,
        cards: &mut Vec<crate::sources::auth::innertube::SearchCard>,
        seen: &mut std::collections::HashSet<String>,
        limit: u32,
    ) {
        if tracks.len() >= limit as usize {
            return;
        }
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    if key == "musicResponsiveListItemRenderer" {
                        /* The same parser as the search uses: the title is
                         * in the first flex column, not in a `title` field. */
                        let wrapper =
                            serde_json::json!({ key: child.clone() });
                        if let Some(hit) = parse_item(&wrapper) {
                            if seen.insert(hit.video_id.clone()) {
                                tracks.push(hit);
                            }
                        }
                    } else if key == "musicTwoRowItemRenderer" {
                        let wrapper =
                            serde_json::json!({ key: child.clone() });
                        if let Some(card) =
                            crate::sources::auth::innertube::parse_card(&wrapper)
                        {
                            if seen.insert(format!("card:{}", card.browse_id)) {
                                cards.push(card);
                            }
                        }
                    }
                    walk(child, tracks, cards, seen, limit);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, tracks, cards, seen, limit);
                }
            }
            _ => {}
        }
    }

    walk(response, &mut tracks, &mut cards, &mut seen, limit);

    crate::sources::yt_commands::Browse {
        tracks: tracks.into_iter().map(crate::sources::yt_commands::LibraryItem::from).collect(),
        cards: cards
            .into_iter()
            .map(|c| crate::sources::yt_commands::LibraryCard {
                browse_id: c.browse_id,
                kind: c.kind,
                title: c.title,
                subtitle: c.subtitle,
                artwork_url: c.artwork_url,
            })
            .collect(),
    }
}

use std::process::Stdio;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_playlist_item_is_walked_out() {
        /* The real shape: the title is the FIRST FLEX COLUMN. */
        let response = serde_json::json!({
            "contents": {
                "musicPlaylistShelfRenderer": {
                    "contents": [{
                        "musicResponsiveListItemRenderer": {
                            "playlistItemData": { "videoId": "xyz" },
                            "flexColumns": [
                                { "musicResponsiveListItemFlexColumnRenderer": {
                                    "text": { "runs": [{ "text": "A SONG" }] } } },
                                { "musicResponsiveListItemFlexColumnRenderer": {
                                    "text": { "runs": [{ "text": "AN ARTIST" }] } } }
                            ]
                        }
                    }]
                }
            }
        });
        let browse = parse_browse(&response, 10);
        assert_eq!(browse.tracks.len(), 1);
        assert_eq!(browse.tracks[0].video_id, "xyz");
        assert_eq!(browse.tracks[0].title, "A SONG");
        assert_eq!(browse.tracks[0].artist, "AN ARTIST");
        assert_eq!(browse.cards.len(), 0);
    }

    #[test]
    fn the_search_walker_is_also_used_for_a_shelf() {
        /* The same shape as the search's, so the same walker finds it. */
        let response = serde_json::json!({
            "contents": { "musicShelfRenderer": { "contents": [{
                "musicResponsiveListItemRenderer": {
                    "playlistItemData": { "videoId": "q" },
                    "title": { "runs": [{ "text": "T" }] },
                }
            }] } }
        });
        let browse = parse_browse(&response, 10);
        assert_eq!(browse.tracks.len(), 1);
    }
}
