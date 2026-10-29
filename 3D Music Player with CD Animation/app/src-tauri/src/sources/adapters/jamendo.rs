//! Jamendo — open-licensed music with real, complete tracks.
//!
//! Jamendo is the good one. Every track is licensed under a Creative Commons
//! licence, the catalogue is searchable, and the API hands back a **direct
//! MP3 URL**. No extraction, no scraping, no token expiring in twenty
//! minutes — a plain `GET` that returns the whole file.
//!
//! The licence is per track and it is not always the permissive one. The API
//! says which: `license_ccurl` on every track, and `ccnc`/`ccnd` filters for
//! the NonCommercial and NoDerivatives variants. This adapter reads the
//! licence and reports it, so the user can see what they are playing.
//!
//! The one rough edge: Jamendo's CDN sends **no CORS header**. That does not
//! matter here, because the bytes are fetched in Rust and served from
//! loopback — the browser never talks to Jamendo directly.

use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;

use crate::sources::types::{
    CancellationToken, ContentId, Health, HealthResult, Metadata, OpenedStream, Source, SourceError,
    StreamHandle,
};

/// The API root.
const API: &str = "https://api.jamendo.com/v3.0";

/// What a track looks like in the API's answer.
#[derive(Debug, Deserialize)]
struct JamendoTrack {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    album_name: String,
    #[serde(default)]
    duration: Option<u32>,
    #[serde(default)]
    audio: Option<String>,
    #[serde(default)]
    album_image: Option<String>,
    #[serde(default)]
    license_ccurl: Option<String>,
    /// Only present when `include=licenses` is asked for.
    #[serde(default)]
    licenses: Option<JamendoLicenses>,
}

#[derive(Debug, Deserialize)]
struct JamendoLicenses {
    #[serde(default)]
    cc_url: Option<String>,
    #[serde(default)]
    cc_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<JamendoTrack>,
    #[serde(default)]
    headers: SearchHeaders,
}

#[derive(Debug, Deserialize, Default)]
struct SearchHeaders {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    error_message: Option<String>,
}

/// The Jamendo source.
pub struct Jamendo {
    client: reqwest::Client,
    client_id: Option<String>,
}

impl Jamendo {
    pub fn new(client_id: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { client, client_id }
    }

    fn key(&self) -> Option<&str> {
        self.client_id.as_deref().filter(|k| !k.is_empty())
    }

    /// Search for tracks.
    pub async fn search_tracks(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        let Some(key) = self.key() else {
            return Err(SourceError::NotConfigured(
                "no Jamendo client id — set one in the settings".into(),
            ));
        };
        let limit = limit.clamp(1, 50);
        let url = format!(
            "{API}/tracks/?client_id={}&format=json&limit={}&search={}&include=licenses&audioformat=mp32",
            key,
            limit,
            super::urlencode(query)
        );
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach Jamendo: {e}")))?;

        if !response.status().is_success() {
            return Err(classify(response.status().as_u16()));
        }
        let body: SearchResponse = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("Jamendo said something odd: {e}")))?;

        if !body.headers.success {
            return Err(SourceError::Transient(
                body.headers
                    .error_message
                    .unwrap_or_else(|| "Jamendo rejected the search".into()),
            ));
        }

        Ok(body
            .results
            .into_iter()
            .filter_map(|t| {
                // A track with no audio URL is not playable, so it is not a
                // result. Skipping it here means the user never sees a
                // track that would fail a second later.
                if t.audio.is_none() { return None; }
                let license = t
                    .licenses
                    .as_ref()
                    .and_then(|l| l.cc_name.clone().or_else(|| l.cc_url.clone()))
                    .or_else(|| t.license_ccurl.clone());
                let meta = Metadata {
                    title: t.name,
                    artist: t.artist_name,
                    album: t.album_name,
                    duration_secs: t.duration.map(|d| d as u64),
                    artwork_url: t.album_image,
                    license,
                };
                Some((meta, ContentId::new("jamendo", t.id)))
            })
            .collect())
    }

    /// The address of a track's audio, and its metadata.
    async fn track_of(&self, id: &str) -> Result<JamendoTrack, SourceError> {
        let Some(key) = self.key() else {
            return Err(SourceError::NotConfigured("no Jamendo client id".into()));
        };
        let url = format!(
            "{API}/tracks/?client_id={key}&format=json&id={}&include=licenses",
            id
        );
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach Jamendo: {e}")))?;
        if !response.status().is_success() {
            return Err(classify(response.status().as_u16()));
        }
        let body: SearchResponse = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("Jamendo said something odd: {e}")))?;
        body.results
            .into_iter()
            .next()
            .ok_or_else(|| SourceError::NotFound("Jamendo no longer has that track".into()))
    }
}

#[async_trait::async_trait]
impl Source for Jamendo {
    fn id(&self) -> &str {
        "jamendo"
    }

    fn display_name(&self) -> &str {
        "Jamendo (open-licensed)"
    }

    fn is_configured(&self) -> bool {
        self.key().is_some()
    }

    fn not_configured_reason(&self) -> Option<String> {
        if self.key().is_some() {
            None
        } else {
            Some("no Jamendo client id — get a free one at devportal.jamendo.com".into())
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
        let health = match self.key() {
            None => Health::Unhealthy("no client id".into()),
            Some(key) => {
                let url = format!("{API}/tracks/?client_id={key}&format=json&limit=1");
                match self.client.get(&url).send().await {
                    Ok(response) if response.status().is_success() => Health::Healthy,
                    Ok(response) => Health::Unhealthy(format!("Jamendo said {}", response.status())),
                    Err(e) => Health::Unhealthy(format!("could not reach Jamendo: {e}")),
                }
            }
        };
        HealthResult {
            health,
            latency_ms: started.elapsed().as_millis() as u64,
            checked_at: crate::sources::now_ms(),
        }
    }

    async fn open_stream(
        &self,
        content: &ContentId,
        cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError> {
        let track = self.track_of(&content.external_id).await?;
        let audio = track
            .audio
            .ok_or_else(|| SourceError::NotFound("that track has no audio".into()))?;

        /* This is the handshake: the bytes are fetched here, in Rust, and the
         * first one is read before the handle is handed over. If the fetch
         * fails the player never hears about it. */
        let (content_length, content_type) = self
            .fetch_head(&audio, cancellation)
            .await?;

        let client = self.client.clone();
        let audio_url = audio.clone();
        let opener = std::sync::Arc::new(
            move |range: Option<(u64, Option<u64>)>| {
                let client = client.clone();
                let audio_url = audio_url.clone();
                crate::sources::types::boxed_stream(async move {
                    let mut request = client.get(&audio_url);
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
                        return Err(classify(response.status().as_u16()));
                    }
                    let length = response.content_length();
                    let kind = response
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());
                    let bytes = response.bytes_stream();
                    Ok(OpenedStream {
                        reader: Box::new(ChainReader::new(bytes.boxed())),
                        content_length: length,
                        content_type: kind,
                    })
                })
            },
        );

        Ok(StreamHandle {
            opener,
            content_length,
            content_type,
            source_id: "jamendo".into(),
            content_id: content.clone(),
        })
    }
}

impl Jamendo {
    /// Fetch the first bytes of the audio, to prove it is really there.
    async fn fetch_head(
        &self,
        url: &str,
        cancellation: &CancellationToken,
    ) -> Result<(Option<u64>, Option<String>), SourceError> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not fetch the audio: {e}")))?;
        if !response.status().is_success() {
            return Err(classify(response.status().as_u16()));
        }
        let content_length = response.content_length();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        /* Read one byte. That is the whole point: a URL that 200s but sends
         * nothing is not a working stream. */
        let mut bytes = response.bytes_stream();
        use futures_util::StreamExt;
        let first = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(SourceError::Cancelled),
            chunk = bytes.next() => chunk,
        };
        match first {
            Some(Ok(chunk)) if !chunk.is_empty() => Ok((content_length, content_type)),
            Some(Ok(_)) => Err(SourceError::Transient("the audio was empty".into())),
            Some(Err(e)) => Err(SourceError::Transient(format!("the audio stopped: {e}"))),
            None => Err(SourceError::Transient("the audio ended immediately".into())),
        }
    }
}

/// A reader that yields the bytes of a reqwest stream.
///
/// A stream hands over chunks that do not line up with the reads, so a
/// chunk that is bigger than the buffer has to be kept for next time. The
/// leftover is held separately from the stream, so nothing is borrowed from
/// itself.
pub struct ChainReader {
    leftover: Option<bytes::Bytes>,
    rest: futures_util::stream::BoxStream<'static, Result<bytes::Bytes, reqwest::Error>>,
}

impl ChainReader {
    pub fn new(
        rest: futures_util::stream::BoxStream<'static, Result<bytes::Bytes, reqwest::Error>>,
    ) -> Self {
        Self {
            leftover: None,
            rest,
        }
    }
}

impl tokio::io::AsyncRead for ChainReader {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = self.get_mut();

        /* Anything left over from last time goes first. */
        if let Some(chunk) = this.leftover.take() {
            let n = std::cmp::min(chunk.len(), buf.remaining());
            buf.put_slice(&chunk[..n]);
            if n < chunk.len() {
                this.leftover = Some(chunk.slice(n..));
            }
            return std::task::Poll::Ready(Ok(()));
        }

        let mut rest = std::pin::Pin::new(&mut this.rest);
        match futures_util::Stream::poll_next(rest.as_mut(), cx) {
            std::task::Poll::Ready(Some(Ok(chunk))) => {
                let n = std::cmp::min(chunk.len(), buf.remaining());
                buf.put_slice(&chunk[..n]);
                if n < chunk.len() {
                    this.leftover = Some(chunk.slice(n..));
                }
                std::task::Poll::Ready(Ok(()))
            }
            std::task::Poll::Ready(Some(Err(e))) => {
                std::task::Poll::Ready(Err(std::io::Error::other(e)))
            }
            std::task::Poll::Ready(None) => std::task::Poll::Ready(Ok(())),
            std::task::Poll::Pending => std::task::Poll::Pending,
        }
    }
}

/// Turn a status code into the right kind of failure.
pub fn classify(status: u16) -> SourceError {
    match status {
        401 | 403 => SourceError::Refused(format!("the provider said {status}")),
        429 => SourceError::Refused(format!("the provider is rate limiting ({status})")),
        404 | 410 => SourceError::NotFound(format!("nothing there ({status})")),
        s => SourceError::Transient(format!("the provider said {s}")),
    }
}

/// Percent-encode a query for a URL.
pub fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
