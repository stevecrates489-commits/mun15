//! The commands for signing in to Spotify.
//!
//! Spotify is signed in with its own OAuth flow, because a YouTube cookie
//! means nothing to Spotify. The browser is the system browser — Spotify's
//! own page, on Spotify's own domain — and the app listens on
//! `127.0.0.1` for the redirect that comes back.

use std::sync::Arc;

use tauri::State;

use super::auth::spotify::{self, SpotifyTokens};
use super::SourceState;

/// A sign-in that is in progress.
pub struct SpotifySignInState {
    /// The sign-in, while it is waiting for the browser.
    pub current: std::sync::Mutex<Option<Arc<spotify::SpotifySignIn>>>,
    /// The code that Spotify redirected with, once it has arrived.
    ///
    /// An  because the listener task owns a copy of it.
    pub code: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}

/// Start the sign-in: open the browser on Spotify's authorize page.
#[tauri::command]
pub async fn spotify_sign_in_start(
    state: State<'_, SourceState>,
    sign_in: State<'_, SpotifySignInState>,
) -> Result<String, String> {
    let client_id = state
        .settings
        .read()
        .unwrap()
        .spotify_client_id
        .clone()
        .unwrap_or_default();
    if client_id.trim().is_empty() {
        return Err(
            "no Spotify client id — make an app at developer.spotify.com and put its id in the settings"
                .into(),
        );
    }

    /* A port for the callback. The app listens there while the browser
     * is open, and the redirect comes back to it. */
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("could not open a port for the sign-in: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not work out the port: {e}"))?
        .port();

    let started = spotify::start(&client_id, port)?;

    /* Listen for the redirect. One request, and then the listener is
     * done with. */
    let code_slot = sign_in.code.clone();
    tokio::spawn(async move {
        use axum::routing::get;
        use axum::Router;

        let app = Router::new().route(
            "/callback",
            get(
                |request: axum::http::Request<axum::body::Body>| async move {
                    let query = request.uri().query().unwrap_or_default().to_string();
                    let mut code = String::new();
                    let mut error = String::new();
                    for pair in query.split("&") {
                        let Some((key, value)) = pair.split_once("=") else { continue };
                        let value = percent_decode(value);
                        match key {
                            "code" => code = value,
                            "error" => error = value,
                            _ => {}
                        }
                    }
                    *code_slot.lock().unwrap() = if code.is_empty() {
                        None
                    } else {
                        Some(code.clone())
                    };
                    let message = if code.is_empty() {
                        format!("Spotify did not give a code: {error}")
                    } else {
                        "YOU CAN GO BACK TO THE APP NOW.".to_string()
                    };
                    format!(
                        "<!doctype html><meta charset=utf-8>\
                         <title>MUN15H</title>\
                         <body style=\"font-family:monospace;background:#111;color:#eee;\
                         padding:3rem;text-align:center\">\
                         <h1 style=\"letter-spacing:.3em;font-size:1rem\">{message}</h1>\
                         <p style=\"color:#888;font-size:.8rem\">Spotify · MUN15H</p>\
                         </body>"
                    )
                },
            ),
        );
        let _ = axum::serve(listener, app).await;
    });

    /* Open the browser. The system browser, on Spotify's own page. */
    let url = started.authorize_url.clone();
    open_in_the_system_browser(&url);

    *sign_in.current.lock().unwrap() = Some(Arc::new(started));
    Ok(url)
}

/// The user came back. Exchange the code for a token.
#[tauri::command]
pub async fn spotify_sign_in_finish(
    state: State<'_, SourceState>,
    sign_in: State<'_, SpotifySignInState>,
) -> Result<SpotifyTokens, String> {
    let current = sign_in.current.lock().unwrap().clone();
    let Some(current) = current else {
        return Err("there is no sign-in in progress".into());
    };

    /* Wait a little for the redirect to arrive — the user might have
     * pressed the button before the browser got back. */
    let mut code = None;
    for _ in 0..40 {
        if let Some(found) = sign_in.code.lock().unwrap().clone() {
            code = Some(found);
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    let Some(code) = code else {
        return Err("Spotify did not send the code back — try again".into());
    };

    let tokens = spotify::finish(&current.client_id, &current.verifier, &code, &current.redirect).await?;

    /* Keep it. */
    spotify::save_tokens(state.app_data_dir(), &tokens)?;
    *sign_in.current.lock().unwrap() = None;
    *sign_in.code.lock().unwrap() = None;

    Ok(tokens)
}

/// The sign-in, abandoned.
#[tauri::command]
pub fn spotify_sign_in_cancel(sign_in: State<'_, SpotifySignInState>) {
    *sign_in.current.lock().unwrap() = None;
    *sign_in.code.lock().unwrap() = None;
}

/// Is Spotify signed in?
#[tauri::command]
pub fn spotify_sign_in_status(state: State<'_, SourceState>) -> bool {
    spotify::load_tokens(state.app_data_dir()).is_some()
}

/// Sign out.
#[tauri::command]
pub fn spotify_sign_out(state: State<'_, SourceState>) {
    spotify::forget_tokens(state.app_data_dir());
}

/// Decode a percent-encoded query value.
///
/// The redirect carries the code in the query string, and it may hold
/// characters that have to be escaped.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Open a URL in the user's own browser.
///
/// The system browser, not a window inside the app: the user should see
/// that they are on Spotify's site, and their password should go to
/// Spotify and nowhere else.
fn open_in_the_system_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}
