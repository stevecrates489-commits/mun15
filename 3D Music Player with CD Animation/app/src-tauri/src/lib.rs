mod dannify;
mod sources;
mod visualizer;

use sources::download_commands::DownloadState;
use sources::downloads::DownloadQueue;
use sources::SourceState;
use sources::spotify_commands::SpotifySignInState;
use sources::yt_commands::SignInState;
use visualizer::VisualizerState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VisualizerState::default())
        .manage(SourceState::new(
            std::env::var("APPDATA")
                .or_else(|_| std::env::var("LOCALAPPDATA"))
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("MUN15H"),
        ))
        .manage(SignInState {
            current: std::sync::Mutex::new(None),
        })
        .manage({
            /* The downloads go next to the app's other state, in a
             * folder of their own. */
            let download_dir = std::env::var("APPDATA")
                .or_else(|_| std::env::var("LOCALAPPDATA"))
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("MUN15H")
                .join("downloads");
            let _ = std::fs::create_dir_all(&download_dir);
            DownloadState {
                queue: std::sync::Arc::new(DownloadQueue::new(download_dir.clone(), 3)),
                download_dir,
                organise_by_artist: true,
                program: std::path::PathBuf::from("yt-dlp"),
                cookies: None,
            }
        })
        .manage(SpotifySignInState {
            current: std::sync::Mutex::new(None),
            code: std::sync::Arc::new(std::sync::Mutex::new(None)),
        })
        .setup(|_app| {
            /* Dannify is a Python app and takes a while to come up: a cold
             * interpreter has to read a few hundred modules off the disk,
             * which is most of ten seconds on a machine with a scanner in the
             * way. Started here — before the intro has even drawn — that read
             * runs beside the boot instead of in front of an empty window, so
             * ONLINE is ready by the time anybody can click it. */
            dannify::warm(std::time::Duration::from_millis(0));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dannify::dannify_open,
            dannify::dannify_account,
            dannify::dannify_sign_in,
            dannify::dannify_version,
            visualizer::visualizer_status,
            visualizer::visualizer_start,
            visualizer::visualizer_stop,
            visualizer::visualizer_set_mode,
            visualizer::visualizer_pcm,
            visualizer::visualizer_list_presets,
            visualizer::visualizer_load_preset,
            visualizer::visualizer_preset_step,
            visualizer::visualizer_set_texture_dir,
            visualizer::visualizer_set_size,
            visualizer::visualizer_log_path,
            visualizer::log::visualizer_log,
            sources::commands::sources_status,
            sources::commands::sources_set_settings,
            sources::commands::sources_search,
            sources::commands::sources_search_all,
            sources::commands::sources_play,
            sources::commands::sources_cancel,
            sources::commands::sources_health_check,
            sources::yt_commands::youtube_sign_in_start,
            sources::yt_commands::youtube_sign_in_finish,
            sources::yt_commands::youtube_sign_in_cancel,
            sources::yt_commands::youtube_sign_in_status,
            sources::yt_commands::youtube_sign_out,
            sources::yt_commands::youtube_library,
            sources::yt_commands::youtube_playlist,
            sources::yt_commands::youtube_playlists,
            sources::yt_commands::youtube_export_cookies,
            sources::yt_commands::youtube_library_sections,
            sources::yt_commands::youtube_download,
            sources::yt_commands::youtube_track_info,
            sources::yt_commands::youtube_stream_modes,
            sources::download_commands::downloads_list,
            sources::download_commands::downloads_get,
            sources::download_commands::downloads_add,
            sources::download_commands::downloads_remove,
            sources::download_commands::downloads_clear_finished,
            sources::download_commands::downloads_folder,
            sources::browse_commands::browse_home,
            sources::browse_commands::browse_liked,
            sources::browse_commands::browse_library_playlists,
            sources::browse_commands::browse_history,
            sources::browse_commands::browse_subscriptions,
            sources::browse_commands::browse_artist,
            sources::browse_commands::browse_artist_albums,
            sources::browse_commands::browse_album,
            sources::browse_commands::browse_playlist,
            sources::browse_commands::browse_playlist_continuation,
            sources::browse_commands::browse_moods,
            sources::browse_commands::browse_mood_playlists,
            sources::browse_commands::browse_suggest,
            sources::browse_commands::browse_search,
            sources::browse_commands::browse_radio,
            sources::browse_commands::browse_follow,
            sources::browse_commands::browse_rate,
            sources::browse_commands::browse_add_to_playlist,
            sources::spotify_commands::spotify_sign_in_start,
            sources::spotify_commands::spotify_sign_in_finish,
            sources::spotify_commands::spotify_sign_in_cancel,
            sources::spotify_commands::spotify_sign_in_status,
            sources::spotify_commands::spotify_sign_out,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
