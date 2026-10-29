//! The browse layer — everything YouTube Music can be asked about.
//!
//! This is the catalogue: search, the home feed, the library, artists,
//! albums, playlists, moods, radio, and the three things a signed-in
//! account can *change* (like, follow, add to a playlist).
//!
//! Every one of them is a `browse` or a `next` call to YouTube Music's own
//! JSON API, with the session's signature on it. The calls and their
//! parameters follow the shape the `ytmusicapi` library uses, which is the
//! same shape every other YouTube Music client uses.
//!
//! The responses are walked **by shape**, not by path: the API moves its
//! renderers around, and a field that has moved should cost a title, not a
//! crash.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::auth::innertube::InnerTube;
use super::auth::session::Session;
use super::types::SourceError;

/// How long a call may take. These answer in a few hundred milliseconds
/// when they are healthy.
const CALL_TIMEOUT: Duration = Duration::from_secs(12);

/// The search parameters, one set per facet.
///
/// These are not arbitrary: they are the encoded filters YouTube Music
/// puts in the search request, and they change when YouTube changes them.
const SEARCH_PARAMS: &[(&str, &str)] = &[
    ("songs", "EgWKAQIIAWoMEA4QChADEAQQCRAF"),
    ("videos", "EgWKAQIQAWoMEA4QChADEAQQCRAF"),
    ("albums", "EgWKAQIYAWoMEA4QChADEAQQCRAF"),
    ("artists", "EgWKAQIgAWoMEA4QChADEAQQCRAF"),
    ("communityPlaylists", "EgeKAQQoAEABagwQDhAKEAMQBBAJEAU%3D"),
    ("featuredPlaylists", "EgeKAQQoADgBagwQDhAKEAMQBBAJEAU%3D"),
];

/// The search parameters for a facet.
fn search_params(facet: &str) -> Option<&'static str> {
    SEARCH_PARAMS
        .iter()
        .find(|(name, _)| *name == facet)
        .map(|(_, params)| *params)
}

/// A song.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    /// The video id — YouTube calls a song a video.
    pub video_id: String,
    pub name: String,
    /// The artists.
    pub artists: Vec<String>,
    /// The artists' channel ids, so an artist can be followed.
    pub artist_ids: Vec<ArtistRef>,
    pub album_name: String,
    pub album_id: Option<String>,
    pub cover_url: Option<String>,
    pub duration_secs: Option<u64>,
    pub explicit: bool,
    /// `LIKE`, `INDIFFERENT` or nothing.
    pub like_status: Option<String>,
    pub year: Option<String>,
    pub release_date: Option<String>,
    pub track_number: Option<u32>,
    pub album_track_total: Option<u32>,
}

/// An artist, as a reference from a song.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistRef {
    pub name: String,
    pub id: Option<String>,
}

/// A card: an album, an artist or a playlist.
///
/// It is not a song, and it cannot be played — it is something to *open*,
/// which then lists what is inside it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    /// ALBUM, ARTIST, PLAYLIST or PODCAST.
    pub kind: String,
    /// The id to open it with.
    pub browse_id: String,
    pub name: String,
    pub cover_url: Option<String>,
    /// The line under the name.
    pub subtitle: String,
    pub item_count: Option<u32>,
}

/// A shelf of things, as the home feed and the search results are built
/// from.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub title: String,
    /// The cards on the shelf.
    pub cards: Vec<Card>,
    /// The songs on the shelf, when it is a shelf of songs.
    pub songs: Vec<Song>,
    /// The id for asking for the next page.
    pub continuation: Option<String>,
}

/// A search, across every facet at once.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub songs: Vec<Song>,
    pub artists: Vec<Card>,
    pub albums: Vec<Card>,
    pub playlists: Vec<Card>,
    /// When a facet could not be fetched, the reason.
    pub errors: Vec<String>,
}

/// An artist page.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistPage {
    pub name: String,
    pub description: String,
    pub cover_url: Option<String>,
    pub subscribers: Option<String>,
    pub monthly_listeners: Option<String>,
    pub channel_id: Option<String>,
    pub songs: Vec<Song>,
    pub albums: Vec<Card>,
    pub singles: Vec<Card>,
}

/// An album page.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPage {
    pub name: String,
    pub description: String,
    pub cover_url: Option<String>,
    pub artists: Vec<String>,
    pub year: Option<String>,
    pub track_count: Option<u32>,
    pub tracks: Vec<Song>,
}

/// A playlist page.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPage {
    pub name: String,
    pub description: String,
    pub cover_url: Option<String>,
    pub author: Option<String>,
    pub track_count: Option<u32>,
    pub tracks: Vec<Song>,
    /// The id for asking for the next page.
    pub continuation: Option<String>,
}

/// The explorer: everything YouTube Music can be asked.
pub struct Explorer {
    inner: InnerTube,
}

impl Explorer {
    pub fn new(session: Option<Session>) -> Self {
        Self {
            inner: InnerTube::new(session),
        }
    }

    /// A `browse` call.
    ///
    /// `browse_id` is what tells YouTube what to open: `FEmusic_home`
    /// for the feed, `UC…` for an artist, `MPREb…` for an album, `VL…`
    /// for a playlist.
    async fn browse(
        &self,
        browse_id: &str,
        params: Option<&str>,
    ) -> Result<Value, SourceError> {
        let mut body = json!({ "browseId": browse_id });
        if let Some(params) = params {
            body["params"] = json!(params);
        }
        self.call("browse", body).await
    }

    /// One API call, with a budget.
    async fn call(&self, action: &str, body: Value) -> Result<Value, SourceError> {
        tokio::time::timeout(CALL_TIMEOUT, self.inner.contextual(action, body))
            .await
            .map_err(|_| {
                SourceError::Transient(format!(
                    "YouTube did not answer {action} within {} seconds",
                    CALL_TIMEOUT.as_secs()
                ))
            })?
    }

    /// A `browse` call for the next page of something.
    async fn browse_continuation(&self, continuation: &str) -> Result<Value, SourceError> {
        self.inner
            .contextual("browse", json!({ "continuation": continuation }))
            .await
    }

    /// The home feed.
    pub async fn home(&self, limit: u32) -> Result<Vec<Shelf>, SourceError> {
        let response = self.browse("FEmusic_home", None).await?;
        Ok(parse_shelves(&response, limit as usize))
    }

    /// The songs the account likes.
    pub async fn liked_songs(&self, limit: u32) -> Result<Vec<Song>, SourceError> {
        let response = self.browse("FEmusic_liked_videos", None).await?;
        Ok(parse_songs(&response, limit as usize))
    }

    /// The playlists in the account's library.
    pub async fn library_playlists(&self, limit: u32) -> Result<Vec<Card>, SourceError> {
        let response = self.browse("FEmusic_liked_playlists", None).await?;
        Ok(parse_cards(&response, limit as usize))
    }

    /// The artists the account follows.
    pub async fn subscriptions(&self, limit: u32) -> Result<Vec<Card>, SourceError> {
        let response = self
            .browse("FEmusic_library_corpus_artists", None)
            .await?;
        Ok(parse_cards(&response, limit as usize))
    }

    /// The account's listening history on YouTube Music.
    pub async fn history(&self, limit: u32) -> Result<Vec<Song>, SourceError> {
        let response = self.browse("FEmusic_history", None).await?;
        Ok(parse_songs(&response, limit as usize))
    }

    /// An artist's page.
    pub async fn artist(&self, browse_id: &str) -> Result<ArtistPage, SourceError> {
        let response = self.browse(browse_id, None).await?;
        Ok(parse_artist(&response))
    }

    /// An artist's albums or singles.
    pub async fn artist_albums(
        &self,
        channel_id: &str,
        params: &str,
        limit: u32,
    ) -> Result<Vec<Card>, SourceError> {
        let response = self.browse(channel_id, Some(params)).await?;
        Ok(parse_cards(&response, limit as usize))
    }

    /// An album's page.
    pub async fn album(&self, browse_id: &str) -> Result<AlbumPage, SourceError> {
        let response = self.browse(browse_id, None).await?;
        Ok(parse_album(&response))
    }

    /// A playlist's page.
    pub async fn playlist(
        &self,
        browse_id: &str,
        limit: u32,
    ) -> Result<PlaylistPage, SourceError> {
        /* A playlist's browse id is the plain id; YouTube wants the
         * `VL` prefix. */
        let id = if browse_id.starts_with("VL") {
            browse_id.to_string()
        } else {
            format!("VL{browse_id}")
        };
        let response = self.browse(&id, None).await?;
        Ok(parse_playlist(&response, limit as usize))
    }

    /// The next page of a playlist.
    pub async fn playlist_continuation(
        &self,
        continuation: &str,
        limit: u32,
    ) -> Result<Vec<Song>, SourceError> {
        let response = self.browse_continuation(continuation).await?;
        Ok(parse_songs(&response, limit as usize))
    }

    /// YouTube Music's moods and genres.
    pub async fn moods(&self) -> Result<Vec<Shelf>, SourceError> {
        let response = self.browse("FEmusic_moods", None).await?;
        Ok(parse_moods(&response))
    }

    /// The playlists for one mood or genre.
    pub async fn mood_playlists(&self, params: &str) -> Result<Vec<Card>, SourceError> {
        let response = self.browse("FEmusic_moods", Some(params)).await?;
        Ok(parse_cards(&response, 200))
    }

    /// What the search box offers while something is being typed.
    pub async fn suggest(&self, query: &str, limit: u32) -> Result<Vec<String>, SourceError> {
        let response = self
            .inner
            .contextual(
                "music/get_search_suggestions",
                json!({ "input": query }),
            )
            .await?;
        Ok(parse_suggestions(&response, limit as usize))
    }

    /// Search, across every facet.
    pub async fn search(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<SearchResults, SourceError> {
        let mut out = SearchResults::default();
        let facets: [(&str, &str); 4] = [
            ("songs", "songs"),
            ("artists", "artists"),
            ("albums", "albums"),
            ("communityPlaylists", "playlists"),
        ];
        for (facet, key) in facets {
            match self.search_facet(query, facet, limit).await {
                Ok(found) => match key {
                    "songs" => out.songs = found.songs,
                    "artists" => out.artists = found.artists,
                    "albums" => out.albums = found.albums,
                    _ => out.playlists = found.playlists,
                },
                Err(e) => out.errors.push(format!("{facet}: {e}")),
            }
        }
        Ok(out)
    }

    /// Search one facet.
    ///
    /// The facets are read separately because they are different shapes:
    /// songs are songs, and the rest are cards.
    async fn search_facet(
        &self,
        query: &str,
        facet: &str,
        limit: u32,
    ) -> Result<SearchResults, SourceError> {
        let Some(params) = search_params(facet) else {
            return Err(SourceError::NotConfigured(format!(
                "there is no search facet called {facet}"
            )));
        };
        let response = self
            .inner
            .contextual(
                "search",
                json!({ "query": query, "params": params }),
            )
            .await?;
        let mut out = SearchResults::default();
        match facet {
            "songs" => out.songs = parse_songs(&response, limit as usize),
            "artists" => out.artists = parse_cards(&response, limit as usize),
            "albums" => out.albums = parse_cards(&response, limit as usize),
            _ => out.playlists = parse_cards(&response, limit as usize),
        }
        Ok(out)
    }

    /// The endless mix — what plays when the queue runs out.
    pub async fn radio(&self, video_id: &str, limit: u32) -> Result<Vec<Song>, SourceError> {
        /* The radio is a watch playlist: the video, and the mix that goes
         * with it. */
        let response = self
            .inner
            .contextual(
                "next",
                json!({
                    "enablePersistentPlaylistPanel": true,
                    "isAudioOnly": true,
                    "tunerSettingValue": "AUTOMIX_SETTING_NORMAL",
                    "videoId": video_id,
                    "playlistId": format!("RDAMVM{video_id}"),
                }),
            )
            .await?;
        Ok(parse_watch_queue(&response, limit as usize))
    }

    /// Follow, or unfollow, an artist.
    pub async fn follow(&self, channel_id: &str, follow: bool) -> Result<bool, SourceError> {
        let response = self
            .inner
            .contextual(
                "browse/artist_menu",
                json!({
                    "subscriptionId": channel_id,
                    "subscribed": follow,
                }),
            )
            .await?;
        /* The answer says what it did, but the important thing is that it
         * did not refuse. */
        Ok(response
            .get("actions")
            .map(|v| !v.is_null())
            .unwrap_or(follow))
    }

    /// Like, or unlike, a song.
    pub async fn rate(&self, video_id: &str, liked: bool) -> Result<bool, SourceError> {
        let action = if liked { "like" } else { "removelike" };
        self.inner
            .contextual(
                action,
                json!({ "target": { "videoId": video_id } }),
            )
            .await?;
        Ok(liked)
    }

    /// Add songs to a YouTube Music playlist.
    pub async fn add_to_playlist(
        &self,
        playlist_id: &str,
        video_ids: &[String],
    ) -> Result<bool, SourceError> {
        if video_ids.is_empty() {
            return Ok(false);
        }
        self.inner
            .contextual(
                "browse/edit_playlist",
                json!({
                    "playlistId": playlist_id,
                    "action": "ACTION_ADD_VIDEO",
                    "videoIds": video_ids,
                }),
            )
            .await?;
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// The responses
// ---------------------------------------------------------------------------

/// The text of a field, whether it is a plain string or a run.
pub fn text_of(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    value
        .get("runs")
        .and_then(|r| r.as_array())
        .map(|runs| {
            runs.iter()
                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.is_empty())
        .or_else(|| {
            value
                .get("simpleText")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| {
            value
                .get("accessibility")
                .and_then(|a| a.get("accessibilityData"))
                .and_then(|d| d.get("label"))
                .and_then(|l| l.as_str())
                .map(|s| s.to_string())
        })
}

/// The biggest picture on offer.
pub fn thumbnail_of(renderer: &Value) -> Option<String> {
    let thumbnails = renderer
        .get("thumbnail")
        .and_then(|t| t.get("musicThumbnailRenderer"))
        .and_then(|t| t.get("thumbnail"))
        .and_then(|t| t.get("thumbnails"))
        .or_else(|| {
            renderer
                .get("thumbnail")
                .and_then(|t| t.get("thumbnailRenderer"))
                .and_then(|t| t.get("thumbnails"))
        })
        .and_then(|t| t.as_array())?;
    thumbnails
        .last()
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
}

/// The browse id a card points at, and what kind of card it is.
fn browse_target(renderer: &Value) -> Option<(String, String)> {
    let endpoint = renderer.get("navigationEndpoint")?;
    let browse_id = endpoint
        .get("browseEndpoint")
        .and_then(|b| b.get("browseId"))
        .and_then(|b| b.as_str())
        .or_else(|| {
            endpoint
                .get("watchEndpoint")
                .and_then(|w| w.get("playlistId"))
                .and_then(|p| p.as_str())
        })?;
    let kind = if browse_id.starts_with("UC") {
        "ARTIST"
    } else if browse_id.starts_with("MPREb") {
        "ALBUM"
    } else if browse_id.starts_with("MPSP") {
        "PODCAST"
    } else if browse_id.starts_with("VL") || browse_id.starts_with("PL") {
        /* A playlist's browse id comes in two shapes: `VL…` when the
         * endpoint gave it, and a bare `PL…` when it came from a watch
         * endpoint. Both are playlists. */
        "PLAYLIST"
    } else {
        "ALBUM"
    };
    Some((browse_id.to_string(), kind.to_string()))
}

/// The video id a song points at.
fn video_id_of(renderer: &Value) -> Option<String> {
    renderer
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
        .map(|s| s.to_string())
}

/// Turn one list renderer into a song.
///
/// The shape of a row is exact, and it is worth spelling out because
/// getting it wrong is invisible — the row still renders, it just says the
/// wrong thing:
///
/// ```text
///   flexColumns[0]  the TITLE      (a watchEndpoint, so it plays)
///   flexColumns[1]  the ARTIST     (a browseEndpoint, so it can be followed)
///                   …and, in a feed, " • 146M plays" after the name
///   flexColumns[2]  the ALBUM      (a browseEndpoint, so it can be opened)
///   fixedColumns    the DURATION
/// ```
pub fn song_of(renderer: &Value) -> Option<Song> {
    let video_id = video_id_of(renderer)?;

    let columns = column_runs(renderer);

    /* The title is the first column, and the artist and the album are the
     * ones after it. */
    let title = columns.first().cloned().unwrap_or_default();
    let album_line = columns.get(2).cloned().unwrap_or_default();

    /* In a feed the artist line carries the play count after it:
     * "Aneesh, Sarkar & Hruday • 146M plays". The count is not part of
     * the artist's name. */

    /* The artists, each with the channel they can be followed on.
     *
     * The artist column holds two kinds of run: the artists' names, and —
     * in a feed — the play count, which is not a name. The count is a run
     * of its own and it ends in " plays". */
    let artist_runs: Vec<(String, Option<String>)> = column_links(renderer, 1)
        .into_iter()
        .filter(|(text, _)| !text.trim().ends_with(" plays"))
        .collect();
    let artist_line = artist_runs
        .iter()
        .map(|(text, _)| text.as_str())
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string();

    let artists = split_artist_names(&artist_line);
    /* The channel id belongs to the first artist. */
    let first_channel = artist_runs
        .iter()
        .find_map(|(_, id)| id.clone());
    let artist_ids = match first_channel {
        Some(channel) => artists
            .first()
            .map(|name| {
                vec![ArtistRef {
                    name: name.clone(),
                    id: Some(channel),
                }]
            })
            .unwrap_or_default(),
        None => Vec::new(),
    };

    /* The duration lives in the fixed column, and only there. */
    let duration_secs = renderer
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
        .or_else(|| {
            renderer
                .get("lengthText")
                .and_then(|l| l.get("runs"))
                .and_then(|r| r.as_array())
                .and_then(|r| r.first())
                .and_then(|r| r.get("text"))
                .and_then(|t| t.as_str())
                .and_then(parse_duration)
        });

    let explicit = renderer
        .get("badges")
        .and_then(|b| b.as_array())
        .map(|badges| {
            badges.iter().any(|badge| {
                badge
                    .get("musicInlineBadgeRenderer")
                    .and_then(|b| b.get("icon"))
                    .and_then(|i| i.get("iconType"))
                    .and_then(|t| t.as_str())
                    .map(|t| t.contains("EXPLICIT"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);

    /* The album, and the id to open it by. */
    let album_id = column_links(renderer, 2)
        .first()
        .and_then(|(_, id)| id.clone());

    Some(Song {
        video_id,
        name: title,
        artists: artists.clone(),
        artist_ids,
        album_name: album_line.trim().to_string(),
        album_id,
        cover_url: thumbnail_of(renderer),
        duration_secs,
        explicit,
        like_status: None,
        year: None,
        release_date: None,
        track_number: None,
        album_track_total: None,
    })
}

/// The text of each flex column.
fn column_runs(renderer: &Value) -> Vec<String> {
    renderer
        .get("flexColumns")
        .and_then(|c| c.as_array())
        .map(|columns| {
            columns
                .iter()
                .map(|column| {
                    column
                        .get("musicResponsiveListItemFlexColumnRenderer")
                        .and_then(|c| c.get("text"))
                        .and_then(|t| t.get("runs"))
                        .and_then(|r| r.as_array())
                        .map(|runs| {
                            runs.iter()
                                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                                .collect::<Vec<_>>()
                                .join("")
                        })
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The links in one flex column: the text, and the browse id it points at.
fn column_links(renderer: &Value, index: usize) -> Vec<(String, Option<String>)> {
    renderer
        .get("flexColumns")
        .and_then(|c| c.as_array())
        .and_then(|columns| columns.get(index))
        .and_then(|c| c.get("musicResponsiveListItemFlexColumnRenderer"))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.get("runs"))
        .and_then(|r| r.as_array())
        .map(|runs| {
            runs.iter()
                .map(|run| {
                    let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    let browse_id = run
                        .get("navigationEndpoint")
                        .and_then(|n| n.get("browseEndpoint"))
                        .and_then(|b| b.get("browseId"))
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());
                    (text.to_string(), browse_id)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Split "Artist • 146M plays" into the name and the count.
fn split_at_plays(text: &str) -> (String, Option<String>) {
    for separator in [" • ", " · "] {
        if let Some((name, plays)) = text.rsplit_once(separator) {
            if plays.ends_with(" plays") {
                return (name.trim().to_string(), Some(plays.trim().to_string()));
            }
        }
    }
    (text.trim().to_string(), None)
}

/// Split "A, B & C" into the names.
fn split_artist_names(text: &str) -> Vec<String> {
    text.split(" & ")
        .flat_map(|part| part.split(", "))
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

/// Parse `3:45` into seconds.
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

/// Turn one card renderer into a card.
pub fn card_of(renderer: &Value) -> Option<Card> {
    let (browse_id, kind) = browse_target(renderer)?;
    let name = text_of(renderer.get("title"))?;
    if name.trim().is_empty() {
        return None;
    }
    let subtitle = text_of(renderer.get("subtitle")).unwrap_or_default();
    let item_count = renderer
        .get("subtitle")
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
        .and_then(|r| r.first())
        .and_then(|r| r.get("text"))
        .and_then(|t| t.as_str())
        .and_then(|t| {
            let digits: String = t.chars().filter(|c| c.is_ascii_digit()).collect();
            digits.parse().ok()
        });
    Some(Card {
        kind,
        browse_id,
        name,
        cover_url: thumbnail_of(renderer),
        subtitle,
        item_count,
    })
}

/// Every item in a response, whatever shape it is in.
fn collect_items(response: &Value, limit: usize) -> Vec<Value> {
    let mut found = Vec::new();
    fn walk(value: &Value, found: &mut Vec<Value>, limit: usize) {
        if found.len() >= limit {
            return;
        }
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    if key == "musicResponsiveListItemRenderer"
                        || key == "musicTwoRowItemRenderer"
                    {
                        found.push(child.clone());
                        if found.len() >= limit {
                            return;
                        }
                    }
                    walk(child, found, limit);
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, found, limit);
                }
            }
            _ => {}
        }
    }
    walk(response, &mut found, limit);
    found
}

/// Every song in a response.
pub fn parse_songs(response: &Value, limit: usize) -> Vec<Song> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for renderer in collect_items(response, limit * 2) {
        if let Some(song) = song_of(&renderer) {
            if seen.insert(song.video_id.clone()) {
                out.push(song);
                if out.len() >= limit {
                    break;
                }
            }
        }
    }
    out
}

/// Every card in a response.
pub fn parse_cards(response: &Value, limit: usize) -> Vec<Card> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for renderer in collect_items(response, limit * 2) {
        if let Some(card) = card_of(&renderer) {
            if seen.insert(card.browse_id.clone()) {
                out.push(card);
                if out.len() >= limit {
                    break;
                }
            }
        }
    }
    out
}

/// The shelves in a response.
pub fn parse_shelves(response: &Value, limit: usize) -> Vec<Shelf> {
    let mut shelves = Vec::new();
    /* A shelf is a `musicShelfRenderer` or a `musicCarouselShelfRenderer`. */
    fn walk(value: &Value, shelves: &mut Vec<Shelf>, limit: usize) {
        if shelves.len() >= limit {
            return;
        }
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    if key == "musicShelfRenderer" || key == "musicCarouselShelfRenderer" {
                        let title = text_of(child.get("title")).unwrap_or_default();
                        let songs = parse_songs(child, 50);
                        let cards = parse_cards(child, 50);
                        let continuation = child
                            .get("continuations")
                            .and_then(|c| c.as_array())
                            .and_then(|c| c.first())
                            .and_then(|c| c.get("nextContinuationData"))
                            .and_then(|c| c.get("continuation"))
                            .and_then(|c| c.as_str())
                            .map(|s| s.to_string());
                        if !songs.is_empty() || !cards.is_empty() {
                            shelves.push(Shelf {
                                title,
                                cards,
                                songs,
                                continuation,
                            });
                        }
                    }
                    walk(child, shelves, limit);
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, shelves, limit);
                }
            }
            _ => {}
        }
    }
    walk(response, &mut shelves, limit);
    shelves
}

/// The moods and genres.
pub fn parse_moods(response: &Value) -> Vec<Shelf> {
    /* The moods come back as a map of title to a list of {title, params}. */
    let mut out = Vec::new();
    if let Some(map) = response.as_object() {
        for (title, items) in map {
            if title == "contents" || title == "header" {
                continue;
            }
            let Some(list) = items.as_array() else {
                continue;
            };
            let cards: Vec<Card> = list
                .iter()
                .filter_map(|item| {
                    let name = item.get("title")?.as_str()?.to_string();
                    let params = item.get("params")?.as_str()?.to_string();
                    Some(Card {
                        kind: "MOOD".into(),
                        browse_id: params,
                        name,
                        cover_url: None,
                        subtitle: String::new(),
                        item_count: None,
                    })
                })
                .collect();
            if !cards.is_empty() {
                out.push(Shelf {
                    title: title.clone(),
                    cards,
                    songs: Vec::new(),
                    continuation: None,
                });
            }
        }
    }
    out
}

/// The suggestions the search box offers.
pub fn parse_suggestions(response: &Value, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let items = response
        .get("contents")
        .and_then(|c| c.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|i| {
                    i.get("searchSuggestionsSectionRenderer")
                        .and_then(|s| s.get("contents"))
                        .and_then(|c| c.as_array())
                })
                .flatten()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for item in items {
        let text = item
            .get("searchSuggestionRenderer")
            .and_then(|s| s.get("suggestion"))
            .and_then(|s| s.get("runs"))
            .and_then(|r| r.as_array())
            .map(|runs| {
                runs.iter()
                    .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        if !text.is_empty() {
            out.push(text);
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}

/// The queue that comes with a video — this is what radio is made of.
pub fn parse_watch_queue(response: &Value, limit: usize) -> Vec<Song> {
    let mut out = Vec::new();
    /* The queue is in the watch panel's playlist, as
     * `musicResponsiveListItemRenderer` rows. */
    fn walk(value: &Value, out: &mut Vec<Song>, limit: usize) {
        if out.len() >= limit {
            return;
        }
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    if key == "musicResponsiveListItemRenderer" {
                        if let Some(song) = song_of(child) {
                            out.push(song);
                            if out.len() >= limit {
                                return;
                            }
                        }
                    }
                    walk(child, out, limit);
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, out, limit);
                }
            }
            _ => {}
        }
    }
    walk(response, &mut out, limit);
    out
}

/// An artist's page.
pub fn parse_artist(response: &Value) -> ArtistPage {
    let header = response
        .get("header")
        .and_then(|h| h.get("musicImmersiveHeaderRenderer"))
        .or_else(|| {
            response
                .get("header")
                .and_then(|h| h.get("musicVisualHeaderRenderer"))
        });
    let name = header
        .and_then(|h| h.get("title"))
        .and_then(|t| text_of(Some(t)))
        .unwrap_or_default();
    let description = header
        .and_then(|h| h.get("description"))
        .and_then(|d| text_of(Some(d)))
        .unwrap_or_default();
    let cover_url = header.and_then(|h| thumbnail_of(h));
    let subscribers = header
        .and_then(|h| h.get("subscriptionButton"))
        .and_then(|b| b.get("subscribeButtonRenderer"))
        .and_then(|b| text_of(b.get("subscribedText")))
        .or_else(|| {
            header
                .and_then(|h| h.get("subscriptionButton"))
                .and_then(|b| b.get("subscribeButtonRenderer"))
                .and_then(|b| text_of(b.get("longSubscriberCountText")))
        });
    let monthly_listeners = header
        .and_then(|h| text_of(h.get("musicMetadataRowRenderer").and_then(|m| m.get("metadata"))))
        .filter(|t| t.to_lowercase().contains("listener"));

    let mut page = ArtistPage {
        name,
        description,
        cover_url,
        subscribers,
        monthly_listeners,
        channel_id: None,
        songs: Vec::new(),
        albums: Vec::new(),
        singles: Vec::new(),
    };

    /* The shelves: the songs, the albums, the singles. */
    for shelf in parse_shelves(response, 12) {
        if !shelf.songs.is_empty() {
            page.songs.extend(shelf.songs);
            continue;
        }
        for card in shelf.cards {
            match card.kind.as_str() {
                "ALBUM" => {
                    if shelf.title.to_lowercase().contains("single") {
                        page.singles.push(card);
                    } else {
                        page.albums.push(card);
                    }
                }
                _ => {}
            }
        }
    }
    page
}

/// An album's page.
pub fn parse_album(response: &Value) -> AlbumPage {
    let header = response
        .get("header")
        .and_then(|h| h.get("musicDetailHeaderRenderer"));
    let name = header
        .and_then(|h| text_of(h.get("title")))
        .unwrap_or_default();
    let description = header
        .and_then(|h| text_of(h.get("description")))
        .unwrap_or_default();
    let cover_url = header.and_then(|h| thumbnail_of(h));
    let year = header
        .and_then(|h| h.get("subtitle"))
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
        .and_then(|r| r.first())
        .and_then(|r| r.get("text"))
        .and_then(|t| t.as_str())
        .and_then(|t| {
            let digits: String = t.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                None
            } else {
                Some(digits)
            }
        });
    let artists: Vec<String> = header
        .and_then(|h| h.get("subtitle"))
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
        .map(|runs| {
            runs.iter()
                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    let mut tracks = parse_songs(response, 500);
    /* The track numbers are in the fixed columns, and they are worth
     * having: an album's tracks should be in order. */
    let numbered = parse_track_numbers(response);
    for (index, track) in tracks.iter_mut().enumerate() {
        if let Some((number, total)) = numbered.get(index) {
            track.track_number = Some(*number);
            track.album_track_total = *total;
        }
    }

    AlbumPage {
        name,
        description,
        cover_url,
        artists,
        year,
        track_count: Some(tracks.len() as u32),
        tracks,
    }
}

/// The track numbers, from the album's fixed columns.
fn parse_track_numbers(response: &Value) -> Vec<(u32, Option<u32>)> {
    let mut out = Vec::new();
    fn walk(value: &Value, out: &mut Vec<(u32, Option<u32>)>) {
        match value {
            Value::Object(map) => {
                if let Some(renderer) = map.get("musicResponsiveListItemRenderer") {
                    let index = renderer
                        .get("index")
                        .and_then(|i| i.as_u64())
                        .map(|i| i as u32);
                    let total = renderer
                        .get("fixedColumns")
                        .and_then(|c| c.as_array())
                        .and_then(|c| c.first())
                        .and_then(|c| c.get("musicResponsiveListItemFixedColumnRenderer"))
                        .and_then(|c| c.get("text"))
                        .and_then(|t| t.get("runs"))
                        .and_then(|r| r.as_array())
                        .and_then(|r| r.first())
                        .and_then(|r| r.get("text"))
                        .and_then(|t| t.as_str())
                        .and_then(|t| {
                            let digits: String =
                                t.chars().filter(|c| c.is_ascii_digit()).collect();
                            digits.parse().ok()
                        });
                    if let Some(number) = index {
                        out.push((number, total));
                    }
                }
                for child in map.values() {
                    walk(child, out);
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, out);
                }
            }
            _ => {}
        }
    }
    walk(response, &mut out);
    out
}

/// A playlist's page.
pub fn parse_playlist(response: &Value, limit: usize) -> PlaylistPage {
    let header = response
        .get("header")
        .and_then(|h| h.get("musicDetailHeaderRenderer"))
        .or_else(|| {
            response
                .get("header")
                .and_then(|h| h.get("musicEditablePlaylistDetailHeaderRenderer"))
        });
    let name = header
        .and_then(|h| text_of(h.get("title")))
        .unwrap_or_default();
    let description = header
        .and_then(|h| text_of(h.get("description")))
        .unwrap_or_default();
    let cover_url = header.and_then(|h| thumbnail_of(h));
    let author = header
        .and_then(|h| h.get("subtitle"))
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
        .and_then(|r| r.first())
        .and_then(|r| r.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let tracks = parse_songs(response, limit);
    let continuation = response
        .get("contents")
        .and_then(|c| c.get("musicPlaylistShelfRenderer"))
        .and_then(|s| s.get("contents"))
        .and_then(|c| c.as_array())
        .and_then(|c| c.last())
        .and_then(|c| c.get("continuationItemRenderer"))
        .and_then(|c| c.get("continuationEndpoint"))
        .and_then(|c| c.get("continuationCommand"))
        .and_then(|c| c.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    PlaylistPage {
        name,
        description,
        cover_url,
        author,
        track_count: Some(tracks.len() as u32),
        tracks,
        continuation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_search_params_are_the_encoded_ones() {
        assert_eq!(search_params("songs"), Some("EgWKAQIIAWoMEA4QChADEAQQCRAF"));
        assert_eq!(search_params("artists"), Some("EgWKAQIgAWoMEA4QChADEAQQCRAF"));
        assert_eq!(search_params("albums"), Some("EgWKAQIYAWoMEA4QChADEAQQCRAF"));
        assert_eq!(search_params("nonsense"), None);
    }

    #[test]
    fn a_card_is_told_apart_by_its_browse_id() {
        let artist = json!({
            "musicTwoRowItemRenderer": {
                "title": { "runs": [{ "text": "AN ARTIST" }] },
                "navigationEndpoint": { "browseEndpoint": { "browseId": "UCabc" } }
            }
        });
        let card = card_of(&artist["musicTwoRowItemRenderer"]).unwrap();
        assert_eq!(card.kind, "ARTIST");
        assert_eq!(card.browse_id, "UCabc");
        assert_eq!(card.name, "AN ARTIST");

        let album = json!({
            "musicTwoRowItemRenderer": {
                "title": { "runs": [{ "text": "AN ALBUM" }] },
                "navigationEndpoint": { "browseEndpoint": { "browseId": "MPREb_x" } }
            }
        });
        assert_eq!(
            card_of(&album["musicTwoRowItemRenderer"]).unwrap().kind,
            "ALBUM"
        );

        let playlist = json!({
            "musicTwoRowItemRenderer": {
                "title": { "runs": [{ "text": "A PLAYLIST" }] },
                "navigationEndpoint": { "watchEndpoint": { "playlistId": "PL1" } }
            }
        });
        let card = card_of(&playlist["musicTwoRowItemRenderer"]).unwrap();
        assert_eq!(card.kind, "PLAYLIST");
    }

    #[test]
    fn a_song_comes_out_of_a_list_row() {
        /* The artist and the album are in SEPARATE columns. */
        let row = json!({
            "playlistItemData": { "videoId": "abc" },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": {
                    "text": { "runs": [{ "text": "A SONG" }] } } },
                { "musicResponsiveListItemFlexColumnRenderer": {
                    "text": { "runs": [{ "text": "AN ARTIST" }] } } },
                { "musicResponsiveListItemFlexColumnRenderer": {
                    "text": { "runs": [{ "text": "AN ALBUM" }] } } }
            ],
            "fixedColumns": [
                { "musicResponsiveListItemFixedColumnRenderer": { "text": { "runs": [
                    { "text": "3:45" }
                ] } } }
            ],
            "badges": [{
                "musicInlineBadgeRenderer": { "icon": { "iconType": "MUSIC_EXPLICIT_BADGE" } }
            }]
        });
        let song = song_of(&row).unwrap();
        assert_eq!(song.video_id, "abc");
        assert_eq!(song.name, "A SONG");
        assert_eq!(song.artists, vec!["AN ARTIST"]);
        assert_eq!(song.album_name, "AN ALBUM");
        assert_eq!(song.duration_secs, Some(225));
        assert!(song.explicit);
    }

    #[test]
    fn a_real_row_from_a_feed_is_read() {
        /* The exact shape, taken from a live answer: the title is in the
         * first column, the artist in the second — with the play count
         * after it — and the album in the third. */
        let row = json!({
            "musicResponsiveListItemRenderer": {
                "trackingParams": "x",
                "thumbnail": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                    { "url": "https://example.invalid/60.jpg", "width": 60 },
                    { "url": "https://example.invalid/544.jpg", "width": 544 }
                ] } } },
                "overlay": { "musicItemThumbnailOverlayRenderer": { "content": {
                    "musicPlayButtonRenderer": { "playNavigationEndpoint": {
                        "watchEndpoint": { "videoId": "yHcHGyg-mY0" }
                    } }
                } } },
                "flexColumns": [
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                        { "text": "Udi Udi" }
                    ] } } },
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                        { "text": "Aneesh, Sarkar & Hruday",
                          "navigationEndpoint": { "browseEndpoint": { "browseId": "UCENhZYUwrR1icuqz-rC-E8w" } } },
                        { "text": " • 146M plays" }
                    ] } } },
                    { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                        { "text": "Udi Udi",
                          "navigationEndpoint": { "browseEndpoint": { "browseId": "MPREb_XrbY15dTfFB" } } }
                    ] } } }
                ],
                "fixedColumns": [
                    { "musicResponsiveListItemFixedColumnRenderer": { "text": { "runs": [
                        { "text": "1:44" }
                    ] } } }
                ],
                "playlistItemData": { "videoId": "yHcHGyg-mY0" }
            }
        });
        let song = song_of(&row["musicResponsiveListItemRenderer"]).unwrap();
        assert_eq!(song.video_id, "yHcHGyg-mY0");
        assert_eq!(song.name, "Udi Udi");
        /* The play count is not part of the artist's name. */
        assert_eq!(song.artists, vec!["Aneesh", "Sarkar", "Hruday"]);
        /* And the album is the third column, not the second. */
        assert_eq!(song.album_name, "Udi Udi");
        assert_eq!(song.album_id.as_deref(), Some("MPREb_XrbY15dTfFB"));
        assert_eq!(song.duration_secs, Some(104));
        assert_eq!(
            song.cover_url.as_deref(),
            Some("https://example.invalid/544.jpg")
        );
    }

    #[test]
    fn the_play_count_is_taken_off_the_artist() {
        assert_eq!(
            split_at_plays("Aneesh • 146M plays"),
            ("Aneesh".to_string(), Some("146M plays".to_string()))
        );
        assert_eq!(
            split_at_plays("Aneesh"),
            ("Aneesh".to_string(), None)
        );
    }

    #[test]
    fn the_artist_names_are_split() {
        assert_eq!(
            split_artist_names("A, B & C"),
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
    }

    #[test]
    fn a_duration_is_parsed() {
        assert_eq!(parse_duration("3:45"), Some(225));
        assert_eq!(parse_duration("1:02:03"), Some(3723));
        assert_eq!(parse_duration("nope"), None);
    }

    #[test]
    fn the_suggestions_are_read() {
        let response = json!({
            "contents": [{
                "searchSuggestionsSectionRenderer": {
                    "contents": [
                        { "searchSuggestionRenderer": {
                            "suggestion": { "runs": [{ "text": "a song" }] }
                        } },
                        { "searchSuggestionRenderer": {
                            "suggestion": { "runs": [{ "text": "an artist" }] }
                        } }
                    ]
                }
            }]
        });
        let found = parse_suggestions(&response, 8);
        assert_eq!(found, vec!["a song", "an artist"]);
    }
}
