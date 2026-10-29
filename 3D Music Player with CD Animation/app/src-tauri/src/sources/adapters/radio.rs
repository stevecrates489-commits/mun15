//! Radio — live streams, and the one source with no end.
//!
//! The app already had a radio browser on the frontend; this adapter is the
//! same idea on the registry's side, so that a station can be played through
//! the same path as everything else: the player gets a loopback URL, and the
//! station's real address stays here.
//!
//! Radio is different from the other sources in one way that matters: a live
//! stream has **no length and no end**. It cannot be probed for a byte and
//! then re-opened at an offset, and seeking in it is meaningless. So the
//! handle is opened once and kept.
//!
//! The stations come from the Radio Browser API, which is a free federation
//! with no key.

use std::time::Duration;

use serde::Deserialize;

use crate::sources::types::{
    CancellationToken, ContentId, Health, HealthResult, Metadata, OpenedStream, Source, SourceError,
    StreamHandle,
};

/// The Radio Browser API. The `all.` prefix is a federation: the servers
/// fail over on their own schedule, so one answer is all that is needed.
const API: &str = "https://all.api.radio-browser.info";

#[derive(Debug, Deserialize)]
struct StationList {
    #[serde(default)]
    stations: Vec<Station>,
}

#[derive(Debug, Deserialize)]
struct Station {
    #[serde(default)]
    stationuuid: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    url_resolved: String,
    #[serde(default)]
    country: String,
    #[serde(default)]
    tags: String,
}

/// The radio source.
pub struct Radio {
    client: reqwest::Client,
}

impl Radio {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

#[async_trait::async_trait]
impl Source for Radio {
    fn id(&self) -> &str {
        "radio"
    }

    fn display_name(&self) -> &str {
        "Internet radio"
    }

    async fn search(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        let limit = limit.clamp(1, 50);
        let url = format!(
            "{API}/json/stations/search?limit={limit}&hidebroken=true&order=votes&reverse=true&q={}",
            super::urlencode(query)
        );
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach the radio directory: {e}")))?;
        if !response.status().is_success() {
            return Err(super::jamendo::classify(response.status().as_u16()));
        }
        let body: StationList = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("the radio directory said something odd: {e}")))?;

        Ok(body
            .stations
            .into_iter()
            .filter_map(|s| {
                /* `url_resolved` is often empty; the plain url is the
                 * fallback. A station with neither is not playable. */
                let address = if s.url_resolved.is_empty() {
                    s.url
                } else {
                    s.url_resolved
                };
                if address.is_empty() || s.stationuuid.is_empty() {
                    return None;
                }
                let meta = Metadata {
                    title: s.name,
                    artist: s.country,
                    album: s.tags,
                    duration_secs: None,
                    artwork_url: None,
                    license: Some("live stream".into()),
                };
                Some((meta, ContentId::new("radio", s.stationuuid)))
            })
            .collect())
    }

    async fn health_check(&self) -> HealthResult {
        let started = std::time::Instant::now();
        let health = match self
            .client
            .get(format!("{API}/json/stations?limit=1&hidebroken=true"))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => Health::Healthy,
            Ok(response) => {
                Health::Unhealthy(format!("the radio directory said {}", response.status()))
            }
            Err(e) => Health::Unhealthy(format!("could not reach the radio directory: {e}")),
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
        let url = format!(
            "{API}/json/stations/byuuid/{}",
            content.external_id
        );
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach the radio directory: {e}")))?;
        if !response.status().is_success() {
            return Err(super::jamendo::classify(response.status().as_u16()));
        }
        let body: StationList = response
            .json()
            .await
            .map_err(|e| SourceError::Transient(format!("the radio directory said something odd: {e}")))?;
        let Some(station) = body.stations.into_iter().next() else {
            return Err(SourceError::NotFound("that station is gone".into()));
        };
        let address = if station.url_resolved.is_empty() {
            station.url
        } else {
            station.url_resolved
        };
        if address.is_empty() {
            return Err(SourceError::NotFound("that station has no address".into()));
        }

        /* A live stream: the first byte proves it is really playing, and
         * then it never ends. */
        let response = self
            .client
            .get(&address)
            .send()
            .await
            .map_err(|e| SourceError::Transient(format!("could not reach the station: {e}")))?;
        if !response.status().is_success() {
            return Err(super::jamendo::classify(response.status().as_u16()));
        }
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
            Some(Ok(_)) => return Err(SourceError::Transient("the station sent nothing".into())),
            Some(Err(e)) => return Err(SourceError::Transient(format!("the station stopped: {e}"))),
            None => return Err(SourceError::Transient("the station ended immediately".into())),
        }

        let client = self.client.clone();
        /* A live stream cannot be re-opened at an offset — there is no
         * offset in a stream that never ends. So the opener always starts
         * from the beginning, and the server never asks for a range of one. */
        let opener = std::sync::Arc::new(move |_range: Option<(u64, Option<u64>)>| {
            let client = client.clone();
            let address = address.clone();
            crate::sources::types::boxed_stream(async move {
                let response = client
                    .get(&address)
                    .send()
                    .await
                    .map_err(|e| SourceError::Transient(format!("could not reach the station: {e}")))?;
                if !response.status().is_success() {
                    return Err(super::jamendo::classify(response.status().as_u16()));
                }
                let kind = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let bytes = response.bytes_stream();
                Ok(OpenedStream {
                    reader: Box::new(super::jamendo::ChainReader::new(bytes.boxed())),
                    /* A live stream has no length. Saying so is better than
                     * guessing: the player shows no seek bar for it. */
                    content_length: None,
                    content_type: kind,
                })
            })
        });

        Ok(StreamHandle {
            opener,
            content_length: None,
            content_type,
            source_id: "radio".into(),
            content_id: content.clone(),
        })
    }
}
