// Prevents an extra console window from opening in release builds.
// The website version runs in the browser; this shell only wraps the same dist/.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    minidisc_player_lib::run()
}
