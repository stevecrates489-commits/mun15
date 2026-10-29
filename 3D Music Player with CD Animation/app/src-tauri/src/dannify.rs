//! The Dannify extension.
//!
//! Dannify is a whole music app of its own, and this is how the player
//! reaches it: the extension lives beside the app in a `dannify/` folder,
//! and this starts it on loopback and hands back the address. Nothing about
//! the local library is involved — the extension has its own player, its
//! own queue and its own data folder, which is what keeps the two apart.
//!
//! Updating Dannify means replacing that folder. This file does not know
//! what version it is starting, only where it is and how to run it.

use std::collections::BTreeMap;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The extension's own port. Fixed, so the interface can reopen the panel
/// without asking where it went.
const PORT: u16 = 8765;

/// Is a launch already under way?
///
/// The warm-up at startup and a click on ONLINE can land at the same moment.
/// Without this, both spawn a Python, and two interpreters importing the same
/// four hundred modules fight over the same disk: neither comes up sooner,
/// and the window waits on the one that loses the race. One launch, and every
/// caller waits on it.
static STARTING: AtomicBool = AtomicBool::new(false);

/// Is something already listening there?
fn is_up() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Where the extension is.
///
/// In development the executable sits in `src-tauri/target/debug`, so the
/// folder is a few levels up; a packaged build keeps it beside the app's
/// own files. Both are looked for, then the working directory, so a build
/// and a source checkout both find it without being told.
fn extension_dir() -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        while let Some(d) = dir {
            roots.push(d.clone());
            dir = d.parent().map(|p| p.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = Some(cwd);
        while let Some(d) = dir {
            roots.push(d.clone());
            dir = d.parent().map(|p| p.to_path_buf());
        }
    }

    for root in roots {
        let candidate = root.join("dannify");
        if candidate.join("run.cmd").is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Start the extension, and return the address once it answers.
///
/// The first launch builds a Python environment for it, which is slow the
/// first time and instant afterwards, so the wait is generous.
#[tauri::command]
pub async fn dannify_open() -> Result<String, String> {
    let url = format!("http://127.0.0.1:{PORT}/");
    if is_up() {
        return Ok(url);
    }

    /* Only the first caller spawns; the others just wait for the port. */
    if !STARTING.swap(true, Ordering::SeqCst) {
        let launched = launch();
        if launched.is_err() {
            STARTING.store(false, Ordering::SeqCst);
            return launched.map(|_| url);
        }
    }

    /* Its start is a few seconds of Python imports — mostly disk and one
       core — so the port answering is the first honest sign it is serving.
       Checked often: every millisecond spent here is a millisecond of the
       window's loading screen. */
    for _ in 0..1200 {
        if is_up() {
            STARTING.store(false, Ordering::SeqCst);
            return Ok(url);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    STARTING.store(false, Ordering::SeqCst);
    Err("The Dannify extension did not come up. Its first launch installs what it needs; try again in a minute.".to_string())
}

/// Spawn the extension's own launcher.
fn launch() -> Result<(), String> {
    let dir = extension_dir().ok_or_else(|| {
        "The Dannify extension is missing: expected a dannify folder beside the app.".to_string()
    })?;

    let mut cmd = Command::new("cmd");
    cmd.arg("/C")
        .arg("run.cmd")
        .current_dir(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up over the player.
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("The Dannify extension would not start: {e}"))
}

/// Start the extension while the player starts, and do not wait for it.
///
/// Dannify is Python: opening its window otherwise pays the whole cold start
/// — interpreter, a few hundred module imports, its own boot — in front of a
/// loading screen. Started here, that cost lands while the player's own intro
/// is still on screen, so the window is instant by the time anybody can click
/// ONLINE. The delay is just long enough not to fight the player's first
/// frames for the disk.
pub fn warm(delay: Duration) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        if is_up() {
            return;
        }
        /* the result is not wanted here: a warm-up that fails leaves the
           click on ONLINE to try again and report the error there */
        let _ = dannify_open().await;
    });
}

// ---------------------------------------------------------------------------
// Signing Dannify in
// ---------------------------------------------------------------------------
//
// The sign-in happens in a real browser: a Chromium browser (Brave, Chrome,
// Edge) encrypts its cookie store against everything outside itself, so the
// only honest way to have the session is to watch the browser the user signs
// in with and take it from there. The extension does that over the DevTools
// connection it opens (see `dannify/browser_signin.py`).
//
// The window below is the way in for a machine where no browser can be
// opened: the player reads the cookies out of its own WebView2, which is
// the one other place they can be read without breaking anything.

/// The sign-in window, by label: one at a time.
const SIGNIN_LABEL: &str = "dannify-signin";

/// Google's sign-in, returning to the YouTube Music the session is for.
const SIGNIN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F&hl=en";

/// The cookies that make a Google session. Only these are read out, and only
/// these are sent: a sign-in window collects far more than the extension
/// needs, and the rest is nobody's business.
const SESSION_COOKIES: &[&str] = &[
    "__Secure-3PAPISID",
    "__Secure-1PAPISID",
    "SAPISID",
    "APISID",
    "SID",
    "HSID",
    "SSID",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "__Secure-1PSIDTS",
    "__Secure-3PSIDTS",
    "__Secure-1PSIDCC",
    "__Secure-3PSIDCC",
    "SIDCC",
    "LOGIN_INFO",
    "PREF",
    "SOCS",
    "VISITOR_INFO1_LIVE",
    "YSC",
];

fn session_url() -> &'static str {
    "https://music.youtube.com/"
}

/// The extension's account, as it stands.
#[tauri::command]
pub async fn dannify_account() -> Result<Value, String> {
    if !is_up() {
        return Ok(json!({ "signed_in": false, "profile": {} }));
    }
    let answer = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{PORT}/api/player/session"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("the extension did not answer: {e}"))?;
    answer
        .json::<Value>()
        .await
        .map_err(|e| format!("the extension sent something unexpected: {e}"))
}

/// Ask the extension to sign in through the browser.
///
/// Returns `None` when that way is not available — no browser here, or an
/// older extension that does not know the route — so the caller can fall
/// back to the built-in window below.
async fn sign_in_through_browser() -> Option<Value> {
    let answer = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{PORT}/api/player/from-browser"))
        // The extension waits with the user (its own limit is five minutes),
        // so this has to outlast it rather than give up first.
        .timeout(Duration::from_secs(330))
        .send()
        .await;
    match answer {
        Ok(response) if response.status().is_success() => response.json::<Value>().await.ok(),
        _ => None,
    }
}

/// Ask the extension what it is, and whether everything this file reaches
/// for in it is still there.
///
/// The player does not need this to play anything — it needs it to be able
/// to say what is wrong. An older extension has no such route and answers
/// 404, which is itself the answer: this copy publishes no report, so the
/// window shows nothing rather than something invented.
#[tauri::command]
pub async fn dannify_version() -> Result<Value, String> {
    if !is_up() {
        return Ok(json!({ "running": false }));
    }
    let answer = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{PORT}/api/player/version"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("the extension did not answer: {e}"))?;
    if !answer.status().is_success() {
        return Ok(json!({ "running": true, "contract": 0 }));
    }
    answer
        .json::<Value>()
        .await
        .map_err(|e| format!("the extension sent something unexpected: {e}"))
}

/// Sign the extension in: the browser first, the player's own window if not.
#[tauri::command]
pub async fn dannify_sign_in(app: AppHandle) -> Result<Value, String> {
    if !is_up() {
        return Err("The Dannify extension is not running yet. Open it first.".to_string());
    }

    if let Some(result) = sign_in_through_browser().await {
        if result.get("unavailable").is_none() {
            return Ok(result);
        }
        // No browser to open: the window below is the other way in.
    }

    let url = SIGNIN_URL
        .parse::<tauri::Url>()
        .map_err(|e| format!("bad sign-in address: {e}"))?;

    match app.get_webview_window(SIGNIN_LABEL) {
        Some(open) => {
            let _ = open.set_focus();
        }
        None => {
            WebviewWindowBuilder::new(&app, SIGNIN_LABEL, WebviewUrl::External(url))
                .title("Sign in to YouTube Music")
                /* Roomier than Google's form needs: on a display at 125% the
                 * page is drawn a little larger than the window asks for,
                 * and a clipped email field is not a sign-in. */
                .inner_size(720.0, 940.0)
                .min_inner_size(480.0, 560.0)
                .center()
                .build()
                .map_err(|e| format!("the sign-in window would not open: {e}"))?;
        }
    }

    /* Google's pages take their time, and a second factor can take minutes.
     * The window is checked once a second; closing it gives up. */
    let jar = loop {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        let Some(window) = app.get_webview_window(SIGNIN_LABEL) else {
            return Ok(json!({ "signed_in": false, "profile": {}, "cancelled": true }));
        };

        let mut found: BTreeMap<String, String> = BTreeMap::new();
        for address in [session_url(), "https://accounts.google.com/"] {
            let Ok(target) = address.parse::<tauri::Url>() else { continue };
            for cookie in window.cookies_for_url(target).unwrap_or_default() {
                let name = cookie.name().to_string();
                if SESSION_COOKIES.contains(&name.as_str()) && !cookie.value().is_empty() {
                    found.insert(name, cookie.value().to_string());
                }
            }
        }

        if found.contains_key("SAPISID") || found.contains_key("__Secure-3PAPISID") {
            break found;
        }
    };

    let answer = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{PORT}/api/player/session"))
        .json(&json!({ "cookies": jar }))
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("the extension did not answer: {e}"))?;

    let result = answer
        .json::<Value>()
        .await
        .map_err(|e| format!("the extension sent something unexpected: {e}"))?;

    let signed_in = result.get("signed_in").and_then(Value::as_bool).unwrap_or(false);
    if signed_in {
        if let Some(window) = app.get_webview_window(SIGNIN_LABEL) {
            let _ = window.close();
        }
        return Ok(result);
    }

    Ok(result)
}
