//! The commands the frontend calls.
//!
//! They are deliberately thin. Everything worth testing lives in the
//! registry and the sources; this is the plumbing that connects the webview
//! to them.

use tauri::State;

use super::{
    search_all, search_source, SearchResult, SourceSettings, SourceState, SourcesStatus,
};

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
