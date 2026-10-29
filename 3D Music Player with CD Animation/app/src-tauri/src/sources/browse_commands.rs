//! The commands the online section calls.
//!
//! Everything here is a thin wrapper over the browse layer, which is
//! where the actual work happens.

use tauri::State;

use super::browse::Explorer;
use super::SourceState;

/// The explorer for the signed-in account.
fn explorer(state: &State<'_, SourceState>) -> Explorer {
    let session = state.session.read().unwrap().clone();
    Explorer::new(session)
}

/// The home feed.
#[tauri::command]
pub async fn browse_home(
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Shelf>, String> {
    let limit = limit.unwrap_or(6).clamp(1, 20);
    explorer(&state)
        .home(limit)
        .await
        .map_err(|e| e.to_string())
}

/// The songs the account likes.
#[tauri::command]
pub async fn browse_liked(
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Song>, String> {
    let limit = limit.unwrap_or(250).clamp(1, 500);
    explorer(&state)
        .liked_songs(limit)
        .await
        .map_err(|e| e.to_string())
}

/// The playlists in the account's library.
#[tauri::command]
pub async fn browse_library_playlists(
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Card>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 100);
    explorer(&state)
        .library_playlists(limit)
        .await
        .map_err(|e| e.to_string())
}

/// The account's history.
#[tauri::command]
pub async fn browse_history(
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Song>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    explorer(&state)
        .history(limit)
        .await
        .map_err(|e| e.to_string())
}

/// The artists the account follows.
#[tauri::command]
pub async fn browse_subscriptions(
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Card>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 200);
    explorer(&state)
        .subscriptions(limit)
        .await
        .map_err(|e| e.to_string())
}

/// An artist's page.
#[tauri::command]
pub async fn browse_artist(
    browse_id: String,
    state: State<'_, SourceState>,
) -> Result<super::browse::ArtistPage, String> {
    explorer(&state)
        .artist(&browse_id)
        .await
        .map_err(|e| e.to_string())
}

/// An artist's albums or singles.
#[tauri::command]
pub async fn browse_artist_albums(
    channel_id: String,
    params: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Card>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 200);
    explorer(&state)
        .artist_albums(&channel_id, &params, limit)
        .await
        .map_err(|e| e.to_string())
}

/// An album's page.
#[tauri::command]
pub async fn browse_album(
    browse_id: String,
    state: State<'_, SourceState>,
) -> Result<super::browse::AlbumPage, String> {
    explorer(&state)
        .album(&browse_id)
        .await
        .map_err(|e| e.to_string())
}

/// A playlist's page.
#[tauri::command]
pub async fn browse_playlist(
    browse_id: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<super::browse::PlaylistPage, String> {
    let limit = limit.unwrap_or(200).clamp(1, 500);
    explorer(&state)
        .playlist(&browse_id, limit)
        .await
        .map_err(|e| e.to_string())
}

/// The next page of a playlist.
#[tauri::command]
pub async fn browse_playlist_continuation(
    continuation: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Song>, String> {
    let limit = limit.unwrap_or(200).clamp(1, 500);
    explorer(&state)
        .playlist_continuation(&continuation, limit)
        .await
        .map_err(|e| e.to_string())
}

/// The moods and genres.
#[tauri::command]
pub async fn browse_moods(
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Shelf>, String> {
    explorer(&state).moods().await.map_err(|e| e.to_string())
}

/// The playlists for one mood.
#[tauri::command]
pub async fn browse_mood_playlists(
    params: String,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Card>, String> {
    explorer(&state)
        .mood_playlists(&params)
        .await
        .map_err(|e| e.to_string())
}

/// What the search box offers while something is being typed.
#[tauri::command]
pub async fn browse_suggest(
    query: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(8).clamp(1, 20);
    explorer(&state)
        .suggest(&query, limit)
        .await
        .map_err(|e| e.to_string())
}

/// Search, across every facet.
#[tauri::command]
pub async fn browse_search(
    query: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<super::browse::SearchResults, String> {
    let limit = limit.unwrap_or(20).clamp(1, 50);
    explorer(&state)
        .search(&query, limit)
        .await
        .map_err(|e| e.to_string())
}

/// The endless mix.
#[tauri::command]
pub async fn browse_radio(
    video_id: String,
    limit: Option<u32>,
    state: State<'_, SourceState>,
) -> Result<Vec<super::browse::Song>, String> {
    let limit = limit.unwrap_or(30).clamp(1, 100);
    explorer(&state)
        .radio(&video_id, limit)
        .await
        .map_err(|e| e.to_string())
}

/// Follow, or unfollow, an artist.
#[tauri::command]
pub async fn browse_follow(
    channel_id: String,
    follow: bool,
    state: State<'_, SourceState>,
) -> Result<bool, String> {
    explorer(&state)
        .follow(&channel_id, follow)
        .await
        .map_err(|e| e.to_string())
}

/// Like, or unlike, a song.
#[tauri::command]
pub async fn browse_rate(
    video_id: String,
    liked: bool,
    state: State<'_, SourceState>,
) -> Result<bool, String> {
    explorer(&state)
        .rate(&video_id, liked)
        .await
        .map_err(|e| e.to_string())
}

/// Add songs to a YouTube Music playlist.
#[tauri::command]
pub async fn browse_add_to_playlist(
    playlist_id: String,
    video_ids: Vec<String>,
    state: State<'_, SourceState>,
) -> Result<bool, String> {
    explorer(&state)
        .add_to_playlist(&playlist_id, &video_ids)
        .await
        .map_err(|e| e.to_string())
}
