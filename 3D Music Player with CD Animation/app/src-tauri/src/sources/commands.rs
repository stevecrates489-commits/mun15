//! The commands the frontend calls.
//!
//! They are deliberately thin. Everything worth testing lives in the
//! registry and the sources; this is the plumbing that connects the webview
//! to them.

use tauri::State;

use super::{
    search_all, search_source, SearchResult, SourceSettings, SourceState, SourcesStatus,
};
use super::types::{boxed_stream, ContentId, OpenedStream, SourceError, StreamHandle, StreamOpener};

/// The state of every source, for the settings screen.
#[tauri::command]
pub fn sources_status(state: State<'_, SourceState>) -> SourcesStatus {
    let settings = state.settings.read().unwrap().clone();
    SourcesStatus {
        sources: state.registry.status(),
        base_url: state.server.base_url(),
        settings,
    }
}

/// Change the settings and rebuild the sources.
#[tauri::command]
pub fn sources_set_settings(
    settings: SourceSettings,
    state: State<'_, SourceState>,
) -> Result<SourcesStatus, String> {
    state.set_settings(settings.clone());
    Ok(SourcesStatus {
        sources: state.registry.status(),
        base_url: state.server.base_url(),
        settings,
    })
}

/// Search one source.
#[tauri::command]
pub async fn sources_search(
    provider: String,
    query: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(25).clamp(1, 50);
    search_source(&state.registry, &provider, &query, limit).await
}

/// Search every source that can search.
#[tauri::command]
pub async fn sources_search_all(
    query: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(25).clamp(1, 50);
    Ok(search_all(&state.registry, &query, limit).await)
}

/// Open a stream and hand back the local URL the player should play.
///
/// The player never sees a remote address. It gets a loopback URL whose id
/// means nothing outside this machine.
#[tauri::command]
pub async fn sources_play(
    content_id: String,
    state: State<'_, SourceState>,
) -> Result<String, String> {
    super::play(&state, &content_id).await
}

/// Check every source's health.
#[tauri::command]
pub async fn sources_health_check(
    state: State<'_, SourceState>,
) -> Result<Vec<super::SourceHealthResult>, String> {
    Ok(state.registry.health_check_all().await)
}

/// Stop whatever is opening right now.
#[tauri::command]
pub fn sources_cancel(state: State<'_, SourceState>) {
    state.cancel_active();
}

/// Give the visualiser a CORS-clean copy of a radio stream.
///
/// A station that sends no `Access-Control-Allow-Origin` cannot be read by a
/// Web Audio analyser: the browser routes it to silence. The app's own loopback
/// server CAN read it (it is a native HTTP client, not a browser), so the
/// stream is fetched here and re-served from `127.0.0.1` with `*` for CORS.
/// The audible element keeps playing the station directly; this tap is a
/// second, measured-only connection.
#[tauri::command]
pub async fn radio_tap(
    url: String,
    state: State<'_, SourceState>,
) -> Result<String, String> {
    let target = url::Url::parse(&url).map_err(|e| format!("bad radio url: {e}"))?;
    if target.scheme() != "http" && target.scheme() != "https" {
        return Err("only http(s) radio streams can be tapped".into());
    }
    if target.host_str().is_none() {
        return Err("the radio url has no host".into());
    }
    let address = target.to_string();

    let opener: StreamOpener = std::sync::Arc::new(move |range| {
        let address = address.clone();
        boxed_stream(async move {
            let client = reqwest::Client::builder()
                .user_agent("MUN15H/1.0")
                .build()
                .map_err(|e| SourceError::Transient(e.to_string()))?;
            let mut request = client.get(&address);
            if let Some((start, end)) = range {
                let value = match end {
                    Some(end) => format!("bytes={start}-{end}"),
                    None => format!("bytes={start}-"),
                };
                request = request.header(reqwest::header::RANGE, value);
            }
            let response = request
                .send()
                .await
                .map_err(|e| SourceError::Transient(e.to_string()))?;
            if !response.status().is_success() {
                return Err(SourceError::Transient(format!(
                    "the station answered {}",
                    response.status()
                )));
            }
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_string());
            let content_length = response.content_length();
            let reader = tokio_util::io::StreamReader::new(
                futures_util::TryStreamExt::map_err(response.bytes_stream(), |e| {
                    std::io::Error::new(std::io::ErrorKind::Other, e)
                }),
            );
            Ok(OpenedStream {
                reader: Box::new(reader),
                content_length,
                content_type,
            })
        })
    });

    let handle = StreamHandle {
        opener,
        content_length: None,
        content_type: Some("audio/mpeg".into()),
        source_id: "radio-tap".into(),
        content_id: ContentId::new("radio-tap", "radio"),
    };
    Ok(state.stream_url(handle))
}
