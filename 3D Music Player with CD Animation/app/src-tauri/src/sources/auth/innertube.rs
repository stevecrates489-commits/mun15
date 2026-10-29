//! The InnerTube client — YouTube Music's own API.
//!
//! This is how the metadata comes: not by scraping a page, but by asking
//! the same JSON API the music site itself asks. Every call is a `POST` to
//!
//! ```text
//! https://music.youtube.com/youtubei/v1/<action>
//! ```
//!
//! with a JSON body carrying the client context, and — when there is a
//! session — the signed headers that say who is asking.
//!
//! # The actions used here
//!
//! | Action | What it is for |
//! |---|---|
//! | `search` | finding music |
//! | `browse` | the home page, an album, an artist, a playlist, the library |
//! | `next` | what comes after a video — the title, the channel, the like state |
//! | `player` | the streams themselves (the cipher and the token live here) |
//! | `account/accounts_list` | which logins are live in the jar |
//! | `account/account_info` | what the account is called, whether it is Premium |
//!
//! The response shapes are walked defensively: the API changes, and a
//! field that has moved should cost a title, not a crash.

use serde_json::Value;

use super::session::{Session, WEB_REMIX_CLIENT_ID, WEB_REMIX_CLIENT_VERSION};

/// A client for YouTube Music's own API.
pub struct InnerTube {
    http: reqwest::Client,
    session: Option<Session>,
}

impl InnerTube {
    pub fn new(session: Option<Session>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { http, session }
    }

        /// Make a call to one of the API's actions.
    pub async fn call(
        &self,
        action: &str,
        body: Value,
    ) -> Result<Value, crate::sources::types::SourceError> {
        let url = format!(
            "https://music.youtube.com/youtubei/v1/{action}?prettyPrint=false"
        );

        let mut request = self.http.post(&url).json(&body);
        request = request.header("Content-Type", "application/json");
        request = request.header("X-Youtube-Client-Name", WEB_REMIX_CLIENT_ID);
        request = request.header("X-Youtube-Client-Version", WEB_REMIX_CLIENT_VERSION);

        if let Some(session) = &self.session {
            /* The signature is made for the music origin, because that is
             * where the request is going. */
            for (name, value) in session.signed_headers(super::session::MUSIC_ORIGIN) {
                request = request.header(name, value);
            }
            let cookies = session.cookie_header();
            if !cookies.is_empty() {
                request = request.header(reqwest::header::COOKIE, cookies);
            }
        }

        let response = request
            .send()
            .await
            .map_err(|e| crate::sources::types::SourceError::Transient(format!("could not reach YouTube: {e}")))?;

        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err(crate::sources::types::SourceError::Refused(format!(
                "YouTube said {status} — the session may have expired"
            )));
        }
        if !response.status().is_success() {
            return Err(crate::sources::types::SourceError::Transient(format!(
                "YouTube said {status}"
            )));
        }

        response
            .json()
            .await
            .map_err(|e| crate::sources::types::SourceError::Transient(format!("YouTube said something odd: {e}")))
    }

    /// A call with the standard context already in the body.
    pub async fn contextual(&self, action: &str, extra: Value) -> Result<Value, crate::sources::types::SourceError> {
        let context = match &self.session {
            Some(session) => session.innertube_context(),
            None => serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "WEB_REMIX",
                        "clientVersion": WEB_REMIX_CLIENT_VERSION,
                        "hl": "en",
                        "gl": "US",
                    },
                    "user": {},
                },
            }),
        };
        let mut body = context;
        if let (Some(target), Some(source)) = (body.get_mut("context"), extra.as_object()) {
            if let Some(map) = target.as_object_mut() {
                for (key, value) in source {
                    map.insert(key.clone(), value.clone());
                }
            }
        }
        self.call(action, body).await
    }

    /// Search for music.
    pub async fn search(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<SearchHit>, crate::sources::types::SourceError> {
        let body = serde_json::json!({
            "query": query,
            "params": "EgWKAQIYAWoKEAMQBAQ%3D%3D",
        });
        let response = self.contextual("search", body).await?;
        Ok(parse_search(&response, limit))
    }

    /// The account's own library.
    pub async fn library(&self, section: &str) -> Result<Value, crate::sources::types::SourceError> {
        let body = serde_json::json!({ "browseId": section });
        self.contextual("browse", body).await
    }

    /// One of the account's playlists.
    pub async fn playlist(&self, playlist_id: &str) -> Result<Value, crate::sources::types::SourceError> {
        let body = serde_json::json!({ "browseId": format!("VL{playlist_id}") });
        self.contextual("browse", body).await
    }

    /// What comes after a video: its title, its channel, and whether it is
    /// liked.
    pub async fn next(&self, video_id: &str) -> Result<Value, crate::sources::types::SourceError> {
        let body = serde_json::json!({ "videoId": video_id });
        self.contextual("next", body).await
    }

    /// The streams for a video.
    ///
    /// This is where the cipher and the token live, and it is the part
    /// that needs the most from the account. The `contentCheckOk` and
    /// `racyCheckOk` flags are what tell YouTube the caller has checked
    /// that the content is allowed in its region and is not age-restricted.
    pub async fn player(&self, video_id: &str) -> Result<Value, crate::sources::types::SourceError> {
        let body = serde_json::json!({
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
            "playbackContext": { "contentPlaybackContext": {} },
        });
        self.contextual("player", body).await
    }

    /// Which logins in the browser's jar are live.
    ///
    /// The answer is a list of accounts, each with the index it has in the
    /// jar — which is the number `X-Goog-AuthUser` wants.
    pub async fn accounts(&self) -> Result<Vec<Account>, crate::sources::types::SourceError> {
        let response = self.call("account/accounts_list", serde_json::json!({})).await?;
        let mut accounts = Vec::new();
        if let Some(list) = response
            .get("accountList")
            .and_then(|l| l.get("accountList"))
            .and_then(|l| l.as_array())
        {
            for (index, account) in list.iter().enumerate() {
                let name = account
                    .get("accountInfo")
                    .and_then(|a| a.get("accountName"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                let email = account
                    .get("accountInfo")
                    .and_then(|a| a.get("email"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                let channel = account
                    .get("accountInfo")
                    .and_then(|a| a.get("channelId"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                if name.is_empty() && email.is_empty() {
                    continue;
                }
                accounts.push(Account {
                    index,
                    name,
                    email,
                    channel_id: channel,
                });
            }
        }
        Ok(accounts)
    }

    /// What the account is, and whether it has YouTube Music Premium.
    ///
    /// Premium is what decides whether the streams carry adverts. Without
    /// it, the account is still signed in — the library and the playlists
    /// work — but the streams are the free ones.
    pub async fn account_info(&self) -> Result<AccountInfo, crate::sources::types::SourceError> {
        let response = self.call("account/account_info", serde_json::json!({})).await?;
        let info = response
            .get("accountInfo")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let name = info
            .get("accountName")
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let email = info
            .get("email")
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        let channel = info
            .get("channelId")
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        /* The Premium flag is a boolean buried in the account's settings.
         * It has moved before, so it is looked for in a few places
         * rather than in one. */
        let premium = find_premium(&response);
        Ok(AccountInfo {
            name,
            email,
            channel_id: channel,
            premium,
        })
    }
}

/// One of the logins in the browser's jar.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// The index in the jar — this is what `X-Goog-AuthUser` wants.
    pub index: usize,
    pub name: String,
    pub email: String,
    pub channel_id: String,
}

/// What the signed-in account is.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub name: String,
    pub email: String,
    pub channel_id: String,
    /// `None` when YouTube did not say.
    pub premium: Option<bool>,
}

/// Find the Premium flag wherever it happens to be.
fn find_premium(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(b) => Some(*b),
        Value::Object(map) => {
            for (key, child) in map {
                let lower = key.to_lowercase();
                if lower.contains("premium") || lower.contains("music_premium") {
                    if let Some(found) = find_premium(child) {
                        return Some(found);
                    }
                }
            }
            /* Not a premium key: look inside, in case it is further down. */
            for child in map.values() {
                if let Some(found) = find_premium(child) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => {
            for child in items {
                if let Some(found) = find_premium(child) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// One thing a search turned up.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// The video id — the thing YouTube calls a video even when it is a
    /// song.
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: Option<u64>,
    pub artwork_url: Option<String>,
    /// The playlist the result came from, when it came from one.
    pub playlist_id: Option<String>,
}

/// Something that is **not** a track: an album, an artist, a playlist, a
/// shelf.
///
/// These are cards, not songs. A card has no video id of its own — it
/// has a *browse* id, which names a collection to open rather than a
/// track to play. Treating a card as a track is what makes a row say
/// "Untitled" and then fail to play: the app asks for a video that does
/// not exist, and the stream never starts.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCard {
    /// The id of the collection to open.
    pub browse_id: String,
    /// What kind of thing it is: an album, an artist, a playlist.
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub artwork_url: Option<String>,
}

/// Walk a search answer and pull the results out of it.
///
/// The response holds a list of tabs, each with a list of items, and each
/// item may be a song, a video, an album, an artist or a playlist. Only
/// the things that can be played are kept.
pub fn parse_search(response: &Value, limit: u32) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let Some(tabs) = response
        .get("contents")
        .and_then(|c| c.get("tabbedSearchResultsRenderer"))
        .and_then(|t| t.get("tabs"))
        .and_then(|t| t.as_array())
    else {
        return hits;
    };

    for tab in tabs {
        let Some(renderer) = tab
            .get("tabRenderer")
            .and_then(|t| t.get("content"))
            .and_then(|c| c.get("sectionListRenderer"))
        else {
            continue;
        };
        let Some(sections) = renderer
            .get("contents")
            .and_then(|c| c.as_array())
        else {
            continue;
        };
        for section in sections {
            let Some(items) = section
                .get("musicShelfRenderer")
                .and_then(|s| s.get("contents"))
                .and_then(|c| c.as_array())
            else {
                continue;
            };
            for item in items {
                if hits.len() >= limit as usize {
                    return hits;
                }
                if let Some(hit) = parse_item(item) {
                    /* The same song can appear in several shelves. */
                    if seen.insert(hit.video_id.clone()) {
                        hits.push(hit);
                    }
                }
            }
        }
    }
    hits
}

/// Turn one search item into a result.
/// The runs of one of the flex columns.
fn column_runs(renderer: &Value, index: usize) -> Vec<String> {
    renderer
        .get("flexColumns")
        .and_then(|c| c.as_array())
        .and_then(|columns| columns.get(index))
        .and_then(|c| {
            c.get("musicResponsiveListItemFlexColumnRenderer")
                .or_else(|| c.get("musicTwoRowItemRenderer"))
        })
        .and_then(|c| c.get("text"))
        .and_then(|t| t.get("runs"))
        .and_then(|r| r.as_array())
        .map(|runs| {
            runs.iter()
                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Split a subtitle into the artist and the album.
///
/// The subtitle arrives as one string — "Artist • Album" — and the
/// separator varies: a bullet, a middot, a hyphen. It is also sometimes
/// several runs rather than one string.
fn split_artist_album(runs: &[String]) -> (String, String) {
    let joined = runs.join("");
    for separator in [" • ", " · ", " – ", " — ", " - ", " | "] {
        if let Some((artist, album)) = joined.split_once(separator) {
            return (artist.trim().to_string(), album.trim().to_string());
        }
    }
    /* Only one part: it is the artist, and there is no album. */
    (joined.trim().to_string(), String::new())
}

/// Turn a card into a collection to open.
///
/// A card is an album, an artist or a playlist. It has a *browse* id, not
/// a video id: opening it lists the things inside it, rather than playing
/// the card itself.
pub fn parse_card(item: &Value) -> Option<SearchCard> {
    let renderer = item.get("musicTwoRowItemRenderer")?;
    let endpoint = renderer.get("navigationEndpoint");
    let browse_id = endpoint
        .and_then(|n| n.get("browseEndpoint"))
        .and_then(|b| b.get("browseId"))
        .and_then(|b| b.as_str())
        .or_else(|| {
            endpoint
                .and_then(|n| n.get("watchEndpoint"))
                .and_then(|w| w.get("playlistId"))
                .and_then(|p| p.as_str())
        })?
        .to_string();

    /* What kind of thing it is, so the UI can say so. */
    let kind = if endpoint
        .and_then(|n| n.get("watchEndpoint"))
        .and_then(|w| w.get("playlistId"))
        .is_some()
    {
        "PLAYLIST"
    } else if browse_id.starts_with("MPRE") {
        "PODCAST"
    } else {
        "ALBUM"
    };

    let title = text_of(renderer.get("title")).unwrap_or_default();
    let subtitle = text_of(renderer.get("subtitle")).unwrap_or_default();
    let artwork_url = renderer
        .get("thumbnailRenderer")
        .and_then(|t| t.get("thumbnail"))
        .and_then(|t| t.get("thumbnails"))
        .and_then(|t| t.as_array())
        .and_then(|t| t.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    Some(SearchCard {
        browse_id,
        kind: kind.to_string(),
        title,
        subtitle,
        artwork_url,
    })
}

/// Turn one item into a result.
///
/// Two shapes are handled, because YouTube Music uses both:
///
/// - **\`musicResponsiveListItemRenderer\`** — the rows in a list. Here
///   the title is in the **first flex column**, not in a \`title\` field,
///   and the second column holds "artist • album".
/// - **\`musicTwoRowItemRenderer\`** — the cards for an album or an
///   artist. Here there *is* a \`title\` field, and a \`subtitle\`.
///
/// Getting this wrong shows every row as "Untitled" while the artist line
/// is perfectly correct, which is exactly what it looks like.
pub fn parse_item(item: &Value) -> Option<SearchHit> {
    /* ONLY the list renderer is a track. The two-row renderer is a card
     * — an album, an artist, a playlist — and it has no video id. */
    let renderer = item.get("musicResponsiveListItemRenderer")?;

    /* The video id. */
    let video_id = renderer
        .get("playlistItemData")
        .and_then(|d| d.get("videoId"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            renderer
                .get("overlay")
                .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
                .and_then(|o| o.get("content"))
                .and_then(|c| c.get("musicPlayButtonRenderer"))
                .and_then(|p| p.get("playNavigationEndpoint"))
                .and_then(|n| n.get("watchEndpoint"))
                .and_then(|w| w.get("videoId"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            renderer
                .get("navigationEndpoint")
                .and_then(|n| n.get("watchEndpoint"))
                .and_then(|w| w.get("videoId"))
                .and_then(|v| v.as_str())
        })
        ?
        .to_string();

    /* The title: the first column, or the field. */
    let column_title = column_runs(renderer, 0).join("");
    let title = if !column_title.is_empty() {
        column_title
    } else {
        text_of(renderer.get("title")).unwrap_or_default()
    };

    /* The artist and the album: the second column, or the subtitle. */
    let column_subtitle = column_runs(renderer, 1);
    let subtitle_runs = if !column_subtitle.is_empty() {
        column_subtitle
    } else {
        text_of(renderer.get("subtitle"))
            .map(|text| vec![text])
            .unwrap_or_default()
    };
    let (artist, album) = split_artist_album(&subtitle_runs);

    /* How long it is. */
    let duration_secs = renderer
        .get("lengthText")
        .and_then(|l| l.get("runs"))
        .and_then(|r| r.as_array())
        .and_then(|r| r.first())
        .and_then(|r| r.get("text"))
        .and_then(|t| t.as_str())
        .and_then(parse_duration)
        .or_else(|| {
            renderer
                .get("fixedColumns")
                .and_then(|c| c.as_array())
                .and_then(|columns| columns.first())
                .and_then(|c| c.get("musicResponsiveListItemFixedColumnRenderer"))
                .and_then(|c| c.get("text"))
                .and_then(|t| t.get("runs"))
                .and_then(|r| r.as_array())
                .and_then(|r| r.first())
                .and_then(|r| r.get("text"))
                .and_then(|t| t.as_str())
                .and_then(parse_duration)
        });

    /* The picture: the biggest one on offer. */
    let artwork_url = renderer
        .get("thumbnail")
        .and_then(|t| t.get("musicThumbnailRenderer"))
        .and_then(|t| t.get("thumbnail"))
        .and_then(|t| t.get("thumbnails"))
        .and_then(|t| t.as_array())
        .and_then(|t| t.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    let playlist_id = renderer
        .get("navigationEndpoint")
        .and_then(|n| n.get("watchEndpoint"))
        .and_then(|w| w.get("playlistId"))
        .and_then(|p| p.as_str())
        .map(|s| s.to_string());

    Some(SearchHit {
        video_id,
        title,
        artist,
        album,
        duration_secs,
        artwork_url,
        playlist_id,
    })
}

/// The text of a field, whether it is a plain string or a run.
fn text_of(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    value
        .get("runs")
        .and_then(|r| r.as_array())
        .and_then(|r| r.first())
        .and_then(|r| r.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            value
                .get("simpleText")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        })
}

/// Parse `3:45` or `1:02:03` into seconds.
pub fn parse_duration(text: &str) -> Option<u64> {
    let parts: Vec<u64> = text
        .split(':')
        .filter_map(|p| p.trim().parse().ok())
        .collect();
    if parts.is_empty() {
        return None;
    }
    let mut seconds = 0u64;
    for part in parts {
        seconds = seconds * 60 + part;
    }
    Some(seconds)
}

/// The library sections, and what they are called.
pub const LIBRARY_SECTIONS: &[(&str, &str)] = &[
    ("FEmusic_history", "HISTORY"),
    ("FEmusic_liked_videos", "LIKED SONGS"),
    ("FEmusic_liked_albums", "ALBUMS"),
    ("FEmusic_liked_artists", "ARTISTS"),
    ("FEmusic_liked_playlists", "PLAYLISTS"),
    ("FEmusic_mixed_for_you", "FOR YOU"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_duration_is_parsed() {
        assert_eq!(parse_duration("3:45"), Some(225));
        assert_eq!(parse_duration("1:02:03"), Some(3723));
        assert_eq!(parse_duration("nonsense"), None);
    }

    #[test]
    fn the_premium_flag_is_found_wherever_it_is() {
        assert_eq!(find_premium(&serde_json::json!(true)), Some(true));
        assert_eq!(find_premium(&serde_json::json!(false)), Some(false));
        assert_eq!(
            find_premium(&serde_json::json!({ "a": { "b": { "isMusicPremium": true } } })),
            Some(true)
        );
        assert_eq!(find_premium(&serde_json::json!({ "a": 1 })), None);
    }

    #[test]
    fn an_empty_search_gives_nothing() {
        let hits = parse_search(&serde_json::json!({}), 10);
        assert!(hits.is_empty());
    }

    #[test]
    fn a_search_result_is_walked_out() {
        /* The REAL shape of a row in a YouTube Music list: the title is in
         * the FIRST FLEX COLUMN, not in a `title` field. The `title`
         * field only exists on the two-row cards. */
        let response = serde_json::json!({
            "contents": {
                "tabbedSearchResultsRenderer": {
                    "tabs": [{
                        "tabRenderer": {
                            "content": {
                                "sectionListRenderer": {
                                    "contents": [{
                                        "musicShelfRenderer": {
                                            "contents": [{
                                                "musicResponsiveListItemRenderer": {
                                                    "playlistItemData": { "videoId": "abc123" },
                                                    "flexColumns": [
                                                        { "musicResponsiveListItemFlexColumnRenderer": {
                                                            "text": { "runs": [{ "text": "A SONG" }] } } },
                                                        { "musicResponsiveListItemFlexColumnRenderer": {
                                                            "text": { "runs": [
                                                                { "text": "AN ARTIST" },
                                                                { "text": " • " },
                                                                { "text": "AN ALBUM" }
                                                            ] } } }
                                                    ],
                                                    "lengthText": { "runs": [{ "text": "3:45" }] },
                                                    "thumbnail": { "musicThumbnailRenderer": {
                                                        "thumbnail": { "thumbnails": [
                                                            { "url": "https://example.invalid/small.jpg", "width": 60 },
                                                            { "url": "https://example.invalid/big.jpg", "width": 544 }
                                                        ] } } }
                                                }
                                            }]
                                        }
                                    }]
                                }
                            }
                        }
                    }]
                }
            }
        });
        let hits = parse_search(&response, 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].video_id, "abc123");
        assert_eq!(hits[0].title, "A SONG");
        assert_eq!(hits[0].artist, "AN ARTIST");
        assert_eq!(hits[0].album, "AN ALBUM");
        assert_eq!(hits[0].duration_secs, Some(225));
        /* The biggest picture on offer. */
        assert_eq!(
            hits[0].artwork_url.as_deref(),
            Some("https://example.invalid/big.jpg")
        );
    }

    #[test]
    fn the_title_is_in_the_first_column_not_a_title_field() {
        /* This is the bug that made every row say "Untitled" while the
         * artist line was perfectly correct: the parser was looking for
         * a `title` field that the list shape does not have. */
        let item = serde_json::json!({
            "musicResponsiveListItemRenderer": {
                "playlistItemData": { "videoId": "xyz" },
                "flexColumns": [
                    { "musicResponsiveListItemFlexColumnRenderer": {
                        "text": { "runs": [{ "text": "THE REAL TITLE" }] } } },
                    { "musicResponsiveListItemFlexColumnRenderer": {
                        "text": { "runs": [{ "text": "ARTIST • ALBUM" }] } } }
                ]
            }
        });
        let hit = parse_item(&item).expect("the row should parse");
        assert_eq!(hit.title, "THE REAL TITLE");
        assert_eq!(hit.artist, "ARTIST");
        assert_eq!(hit.album, "ALBUM");
    }

    #[test]
    fn a_two_row_card_is_a_card_not_a_track() {
        /* The other shape: an album or an artist card. It is NOT a track —
         * it has a browse id, and it is opened rather than played. */
        let item = serde_json::json!({
            "musicTwoRowItemRenderer": {
                "title": { "runs": [{ "text": "AN ALBUM" }] },
                "subtitle": { "runs": [{ "text": "AN ARTIST" }] },
                "navigationEndpoint": { "watchEndpoint": { "playlistId": "PL1" } }
            }
        });
        /* The track parser must refuse it — that is the whole point: a card
         * has no video id, and treating it as a track is what makes a row
         * that will not play. */
        assert!(parse_item(&item).is_none());
        /* And the card parser must take it. */
        let card = parse_card(&item).expect("the card should parse");
        assert_eq!(card.browse_id, "PL1");
        assert_eq!(card.kind, "PLAYLIST");
        assert_eq!(card.title, "AN ALBUM");
        assert_eq!(card.subtitle, "AN ARTIST");
    }

    #[test]
    fn the_separator_varied() {
        assert_eq!(
            split_artist_album(&["A • B".into()]),
            ("A".to_string(), "B".to_string())
        );
        assert_eq!(
            split_artist_album(&["A · B".into()]),
            ("A".to_string(), "B".to_string())
        );
        assert_eq!(
            split_artist_album(&["A - B".into()]),
            ("A".to_string(), "B".to_string())
        );
        /* Only an artist, and no album. */
        assert_eq!(
            split_artist_album(&["JUST AN ARTIST".into()]),
            ("JUST AN ARTIST".to_string(), String::new())
        );
    }

    #[test]
    fn the_same_song_twice_is_only_one_hit() {
        let item = serde_json::json!({
            "musicResponsiveListItemRenderer": {
                "playlistItemData": { "videoId": "same" },
                "title": { "runs": [{ "text": "T" }] },
            }
        });
        let response = serde_json::json!({
            "contents": { "tabbedSearchResultsRenderer": { "tabs": [{
                "tabRenderer": { "content": { "sectionListRenderer": { "contents": [
                    { "musicShelfRenderer": { "contents": [item.clone()] } },
                    { "musicShelfRenderer": { "contents": [item] } }
                ] } } }
            }] } }
        });
        let hits = parse_search(&response, 10);
        assert_eq!(hits.len(), 1);
    }
}
