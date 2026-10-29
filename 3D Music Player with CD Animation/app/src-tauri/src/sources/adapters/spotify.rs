//! Spotify — **metadata only, and that is not a limitation of this adapter.**
//!
//! Spotify's Web API does not give out audio addresses. Not for full tracks,
//! not for previews (the `preview_url` field is deprecated and usually
//! null), and not through the search endpoint. The API's own words:
//!
//! > "Spotify Web API enables the creation of applications that can interact
//! > with Spotify's streaming service, such as retrieving content metadata,
//! > creating and managing playlists, or controlling playback."
//!
//! Metadata and playback *control*. Not bytes.
//!
//! So what is this adapter for? Two honest things:
//!
//! 1. **Finding things.** It searches Spotify properly — the catalogue
//!    search is excellent — and returns titles, artists, artwork and
//!    durations.
//! 2. **Pointing somewhere.** The result carries the Spotify URI, so the
//!    user can open it in Spotify itself.
//!
//! Playing Spotify audio inside a third-party desktop app is possible only
//! through the Web Playback SDK, which needs the user's own Premium
//! subscription, is restricted to non-commercial use, and *still* does not
//! yield a raw address — it renders the audio itself. That path lives in
//! the frontend, not here, and it is a separate opt-in.

use std::time::Duration;

use serde::Deserialize;

use crate::sources::types::{
    CancellationToken, ContentId, Health, HealthResult, Metadata, OpenedStream, Source, SourceError,
    StreamHandle,
};

/// The API root.
const API: &str = "https://api.spotify.com/v1";

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    tracks: SearchPage,
}

#[derive(Debug, Deserialize, Default)]
struct SearchPage {
    #[serde(default)]
    items: Vec<TrackItem>,
}

#[derive(Debug, Deserialize)]
struct TrackItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    album: Option<AlbumItem>,
    #[serde(default)]
    artists: Vec<ArtistItem>,
}

#[derive(Debug, Deserialize, Default)]
struct AlbumItem {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    images: Vec<ImageItem>,
}

#[derive(Debug, Deserialize, Default)]
struct ImageItem {
    #[serde(default)]
    url: String,
}

#[derive(Debug, Deserialize, Default)]
struct ArtistItem {
    #[serde(default)]
    name: String,
}

/// The Spotify source. Metadata only.
pub struct Spotify {
    client: reqwest::Client,
    /// The tokens. Held in memory, refreshed by the auth flow.
    tokens: Option<crate::sources::auth::spotify::SpotifyTokens>,
    /// The client id, for the refresh.
    client_id: Option<String>,
}

impl Spotify {
    pub fn new(
        tokens: Option<crate::sources::auth::spotify::SpotifyTokens>,
        client_id: Option<String>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default();
        Self {
            client,
            tokens,
            client_id,
        }
    }

    /// The access token, refreshed if it has run out.
    ///
    /// `None` means "not signed in". An error means the refresh failed —
    /// which usually means the refresh token has gone too, and the user
    /// has to sign in again.
    async fn access_token(&self) -> Result<Option<String>, String> {
        let Some(tokens) = self.tokens.as_ref() else {
            return Ok(None);
        };
        if tokens.is_valid() {
            return Ok(Some(tokens.access_token.clone()));
        }
        let Some(client_id) = self.client_id.as_ref() else {
            return Err("the Spotify session has expired — sign in again".into());
        };
        Ok(Some(tokens.fresh_access_token(client_id).await?))
    }

    /// Search Spotify's catalogue.
    pub async fn search_tracks(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        let token = self
            .access_token()
            .await
            .map_err(SourceError::Transient)?;
        let Some(token) = token else {
            return Err(SourceError::NotConfigured("not signed in to Spotify".into()));
        };
        let limit = limit.clamp(1, 50);
        let url = format!(
            "{API}/search?type=track&limit={limit}&q={}",
            super::urlencode(query)
        );
        let response = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach Spotify: {e}")))?;
        if !response.status().is_success() {
            return Err(super::jamendo::classify(response.status().as_u16()));
        }
        let body: SearchResponse = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("Spotify said something odd: {e}")))?;

        Ok(body
            .tracks
            .items
            .into_iter()
            .filter_map(|t| {
                if t.id.is_empty() {
                    return None;
                }
                let artwork = t
                    .album
                    .as_ref()
                    .and_then(|a| a.images.first().map(|i| i.url.clone()));
                let artist = t
                    .artists
                    .first()
                    .map(|a| a.name.clone())
                    .unwrap_or_default();
                let meta = Metadata {
                    title: t.name,
                    artist,
                    album: t.album.and_then(|a| a.name).unwrap_or_default(),
                    duration_secs: t.duration_ms.map(|ms| ms / 1000),
                    artwork_url: artwork,
                    /* Spotify does not state a licence for its catalogue, and
                     * it is not open-licensed. Saying so is more useful than
                     * saying nothing. */
                    license: Some("proprietary — playable in Spotify only".into()),
                };
                Some((meta, ContentId::new("spotify", t.id)))
            })
            .collect())
    }
}

#[async_trait::async_trait]
impl Source for Spotify {
    fn id(&self) -> &str {
        "spotify"
    }

    fn display_name(&self) -> &str {
        "Spotify (metadata only)"
    }

    fn is_configured(&self) -> bool {
        self.tokens.is_some()
    }

    fn not_configured_reason(&self) -> Option<String> {
        if self.tokens.is_some() {
            None
        } else {
            Some("not signed in to Spotify".into())
        }
    }

    async fn search(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        self.search_tracks(query, limit).await
    }

    async fn health_check(&self) -> HealthResult {
        let started = std::time::Instant::now();
        let health = match self.access_token().await {
            Ok(None) => Health::Unhealthy("not signed in".into()),
            Err(e) => Health::Unhealthy(e.to_string()),
            Ok(Some(token)) => match self
                .client
                .get(format!("{API}/search?type=track&limit=1&q=a"))
                .bearer_auth(token)
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => Health::Healthy,
                Ok(response) => {
                    Health::Unhealthy(format!("Spotify said {}", response.status()))
                }
                Err(e) => Health::Unhealthy(format!("could not reach Spotify: {e}")),
            },
        };
        HealthResult {
            health,
            latency_ms: started.elapsed().as_millis() as u64,
            checked_at: crate::sources::now_ms(),
        }
    }

    async fn open_stream(
        &self,
        _content: &ContentId,
        _cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError> {
        /* Spotify's Web API does not hand out audio, so there is nothing to
         * open here. Saying so plainly is better than pretending. */
        Err(SourceError::NotConfigured(
            "Spotify's API does not provide playable audio — it is a catalogue, not a source of bytes"
                .into(),
        ))
    }
}

/// A reader that is never used, kept so the types line up.
#[allow(dead_code)]
fn never() -> OpenedStream {
    OpenedStream {
        reader: Box::new(tokio::io::empty()),
        content_length: None,
        content_type: None,
    }
}
