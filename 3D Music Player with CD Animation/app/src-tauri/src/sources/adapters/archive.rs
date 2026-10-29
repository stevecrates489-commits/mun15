//! The Internet Archive — public domain and Creative Commons audio.
//!
//! The Archive holds thousands of freely-licensed recordings: live sets,
//! field recordings, public-domain music. The metadata API is open, needs no
//! key, and answers with the server and directory each item lives in — from
//! which the file's real address is built.
//!
//! It is a good second source: when Jamendo is down, the Archive is still
//! there, and the two hold completely different music.

use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;

use super::jamendo::{classify, ChainReader};
use crate::sources::types::{
    CancellationToken, ContentId, Health, HealthResult, Metadata, OpenedStream, Source, SourceError,
    StreamHandle,
};

/// The metadata endpoint.
const METADATA: &str = "https://archive.org/metadata";

/// The search endpoint.
const SEARCH: &str = "https://archive.org/advancedsearch.php";

#[derive(Debug, Deserialize)]
struct ArchiveMetadata {
    #[serde(default)]
    server: String,
    #[serde(default)]
    dir: String,
    #[serde(default)]
    files: Vec<ArchiveFile>,
    #[serde(default)]
    metadata: Option<ArchiveItemMetadata>,
}

#[derive(Debug, Deserialize, Default)]
struct ArchiveItemMetadata {
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ArchiveFile {
    name: String,
    #[serde(default)]
    format: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    response: SearchResponseInner,
}

#[derive(Debug, Deserialize, Default)]
struct SearchResponseInner {
    #[serde(default)]
    docs: Vec<SearchDoc>,
}

#[derive(Debug, Deserialize)]
struct SearchDoc {
    #[serde(default)]
    identifier: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    creator: Option<String>,
    #[serde(default)]
    licenseurl: Option<String>,
}

/// The Internet Archive source.
pub struct Archive {
    client: reqwest::Client,
}

impl Archive {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { client }
    }

    /// Search the Archive's catalogue.
    pub async fn search_tracks(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        let limit = limit.clamp(1, 50);
        let url = format!(
            "{SEARCH}?q={}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=licenseurl&rows={}&page=1&output=json",
            super::urlencode(query),
            limit
        );
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach the Archive: {e}")))?;
        if !response.status().is_success() {
            return Err(classify(response.status().as_u16()));
        }
        let body: SearchResponse = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("the Archive said something odd: {e}")))?;

        Ok(body
            .response
            .docs
            .into_iter()
            .filter(|d| !d.identifier.is_empty())
            .map(|d| {
                let meta = Metadata {
                    title: d.title.clone().unwrap_or_else(|| d.identifier.clone()),
                    artist: d.creator.clone().unwrap_or_default(),
                    album: String::new(),
                    duration_secs: None,
                    artwork_url: None,
                    license: d.licenseurl.clone(),
                };
                (meta, ContentId::new("archive", d.identifier))
            })
            .collect())
    }

    /// The list of playable files in an item, with their addresses.
    async fn files_of(
        &self,
        identifier: &str,
    ) -> Result<(String, Vec<(String, String)>), SourceError> {
        let url = format!("{METADATA}/{identifier}");
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach the Archive: {e}")))?;
        if !response.status().is_success() {
            return Err(classify(response.status().as_u16()));
        }
        let body: ArchiveMetadata = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("the Archive said something odd: {e}")))?;

        let playable: Vec<(String, String)> = body
            .files
            .iter()
            .filter(|f| {
                let name = f.name.to_lowercase();
                let format = f.format.as_deref().unwrap_or("").to_lowercase();
                name.ends_with(".mp3")
                    || name.ends_with(".flac")
                    || name.ends_with(".ogg")
                    || name.ends_with(".wav")
                    || format.contains("vbr mp3")
                    || format.contains("128k mp3")
            })
            .map(|f| {
                let url = format!("https://{}{}/{}", body.server, body.dir, f.name);
                (f.name.clone(), url)
            })
            .collect();

        let title = body
            .metadata
            .and_then(|m| m.title)
            .unwrap_or_else(|| identifier.to_string());
        Ok((title, playable))
    }

    /// Read the first bytes of the audio, to prove it is really there.
    async fn probe(
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

#[async_trait::async_trait]
impl Source for Archive {
    fn id(&self) -> &str {
        "archive"
    }

    fn display_name(&self) -> &str {
        "Internet Archive"
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
        let health = match self
            .client
            .get(format!("{SEARCH}?q=music&rows=1&output=json"))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => Health::Healthy,
            Ok(response) => Health::Unhealthy(format!("the Archive said {}", response.status())),
            Err(e) => Health::Unhealthy(format!("could not reach the Archive: {e}")),
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
        let (_title, files) = self.files_of(&content.external_id).await?;
        let Some((_, url)) = files.into_iter().next() else {
            return Err(SourceError::NotFound(
                "that Archive item has no playable audio".into(),
            ));
        };

        /* The handshake: prove there is a byte behind the address before
         * the handle is handed over. */
        let (content_length, content_type) = self.probe(&url, cancellation).await?;

        let client = self.client.clone();
        let opener = std::sync::Arc::new(move |range: Option<(u64, Option<u64>)>| {
            let client = client.clone();
            let url = url.clone();
            crate::sources::types::boxed_stream(async move {
                let mut request = client.get(&url);
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
        });

        Ok(StreamHandle {
            opener,
            content_length,
            content_type,
            source_id: "archive".into(),
            content_id: content.clone(),
        })
    }
}
