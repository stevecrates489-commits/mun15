//! Signing in to YouTube Music.
//!
//! The flow, in order:
//!
//! 1. A browser is started with a **profile of its own**, in the app's
//!    own folder. Nothing of the user's is touched.
//! 2. It opens YouTube Music. The user signs in, in the browser, with
//!    their own password — nothing is typed on their behalf, and no
//!    credential ever passes through this app.
//! 3. When the user says they are done, the app asks the browser, over
//!    the DevTools Protocol, for its YouTube cookies.
//! 4. Those cookies are turned into a [`Session`]: the signing seed, the
//!    login index, the channel, and whether the account is Premium.
//!
//! The cookies are kept **in memory** and in the app's own state folder.
//! They are not written to the registry's state file, and they are not
//! written anywhere the user did not expect.

pub mod browser;
pub mod cdp;
pub mod innertube;
pub mod session;
pub mod spotify;

use std::path::PathBuf;

use browser::{Browser, Launched};
use cdp::{cookies_for, Cdp, Cookie};
use innertube::InnerTube;
use session::Session;


/// The domains whose cookies are needed.
const YOUTUBE_DOMAINS: &[&str] = &["youtube.com", "google.com"];

/// Where the sign-in profile lives.
pub fn profile_dir(app_data: &std::path::Path) -> PathBuf {
    app_data.join("yt-signin-profile")
}

/// A sign-in that is in progress.
pub struct SignIn {
    pub browser: Browser,
    /// Where the sign-in profile lives. The user is told this, and it is
    /// what `yt-dlp` can be pointed at with
    /// `--cookies-from-browser chrome:<path>`.
    pub profile: PathBuf,
    /// The sign-in browser's process. It has to be closed before the
    /// cookies can be read: the profile is locked while it is running.
    child: std::sync::Mutex<Option<Launched>>,
}

impl SignIn {
    /// Start a browser and open YouTube Music in it.
    ///
    /// The page is given to the browser on the command line, so the right
    /// thing is on screen straight away — no blank tab waiting for a
    /// second request that might fail.
    ///
    /// The browser has **no debugging interface**: a browser with one
    /// sets `navigator.webdriver`, and Google refuses to sign in such a
    /// browser with *"This browser or app may not be secure"*. The
    /// cookies are read afterwards, by a second headless launch of the
    /// same profile.
    pub async fn start(
        app_data: &std::path::Path,
        choice: browser::BrowserChoice,
    ) -> Result<Self, String> {
        let browser = browser::Browser::find(choice)?;
        let profile = profile_dir(app_data);
        let launched = browser.launch_for_sign_in(&profile, "https://music.youtube.com/")?;
        let browser = launched.browser.clone();
        let profile = launched.profile.clone();

        Ok(SignIn {
            browser,
            profile,
            child: std::sync::Mutex::new(Some(launched)),
        })
    }

    /// Has the sign-in browser been closed?
    pub fn is_closed(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        guard
            .as_mut()
            .map(|l| l.has_exited())
            .unwrap_or(true)
    }

    /// Ask the browser for the YouTube cookies and build a session.
    ///
    /// The sign-in browser has to be closed first: it holds the profile
    /// locked, and the second launch needs it. Then the same profile is
    /// opened again, headless, with the debugging interface on — and by
    /// then the sign-in has already happened, so the debugging flag no
    /// longer matters to Google.
    pub async fn collect(&self) -> Result<Session, String> {
        /* Wait for the sign-in browser to close. */
        for _ in 0..60 {
            if self.is_closed() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        if !self.is_closed() {
            return Err(
                "the browser is still open — close the sign-in window and press done again".into(),
            );
        }

        /* And take it out of the way for good. */
        {
            let mut guard = self.child.lock().unwrap();
            if let Some(mut launched) = guard.take() {
                launched.stop();
            }
        }

        /* The second launch: the same profile, headless, with the
         * debugging interface on. */
        let mut headless = self
            .browser
            .launch_headless(&self.profile)
            .map_err(|e| format!("could not read the cookies: {e}"))?;
        let debugger = match headless.wait_for_debugger(std::time::Duration::from_secs(30)).await {
            Ok(debugger) => debugger,
            Err(e) => {
                headless.stop();
                return Err(e);
            }
        };
        let websocket = match debugger.browser_websocket().await {
            Ok(websocket) => websocket,
            Err(e) => {
                headless.stop();
                return Err(e);
            }
        };

        let mut cdp = match Cdp::connect(&websocket).await {
            Ok(cdp) => cdp,
            Err(e) => {
                headless.stop();
                return Err(e);
            }
        };
        let all = cdp.all_cookies().await;
        /* The headless browser has done its job. */
        headless.stop();
        let all = all?;

        let youtube = cookies_for(&all, YOUTUBE_DOMAINS);
        if youtube.is_empty() {
            return Err(
                "the browser had no YouTube cookies — sign in to YouTube Music first".to_string(),
            );
        }
        Ok(Session {
            cookies: youtube,
            made_at: Session::now(),
            ..Default::default()
        })
    }

    /// Close the browser that was started for the sign-in.
    pub fn close(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut launched) = guard.take() {
            launched.stop();
        }
    }
}

/// Build a full session from a set of cookies.
///
/// This asks YouTube two things the cookies alone cannot answer: which
/// login in the jar is the one to use, and what the account is.
pub async fn complete_session(mut session: Session) -> Session {
    let inner = InnerTube::new(Some(session.clone()));

    /* Which logins are live, and which one is the one the music page
     * itself would use. */
    if let Ok(accounts) = inner.accounts().await {
        if !accounts.is_empty() {
            /* The account the cookies are for is the one whose name or
             * email appears in the cookie jar's `__Secure-1PSID`… but
             * the jar does not say which index it is.
             *
             * The answer comes from the music page: it names the session
             * index it is using. Without that, the first live account is
             * the best guess — and the user can see which one was picked
             * in the settings, and sign in with the other if it is
             * wrong. */
            let chosen = accounts
                .iter()
                .find(|a| a.name == session.account_name.as_deref().unwrap_or(""))
                .or_else(|| accounts.first())
                .cloned();
            if let Some(account) = chosen {
                session.auth_user = Some(account.index.to_string());
                if session.channel_id.is_none() && !account.channel_id.is_empty() {
                    session.channel_id = Some(account.channel_id);
                }
                if session.account_name.is_none() && !account.name.is_empty() {
                    session.account_name = Some(account.name);
                }
            }
        }
    }

    /* What the account is, and whether it is Premium. */
    let inner = InnerTube::new(Some(session.clone()));
    if let Ok(info) = inner.account_info().await {
        if !info.name.is_empty() {
            session.account_name = Some(info.name);
        }
        if !info.email.is_empty() {
            session.email = Some(info.email);
        }
        if !info.channel_id.is_empty() {
            session.channel_id = Some(info.channel_id);
        }
        session.premium = info.premium;
    }

    session
}

/// The cookies as a Netscape `cookies.txt`, for `yt-dlp`.
///
/// This is the format `yt-dlp` reads, and the one that lets the user
/// choose which browser to take them from with
/// `--cookies-from-browser`. Writing it is a convenience, not a
/// requirement: the stream resolution in this app does its own fetching
/// with the cookies it already has.
pub fn as_cookies_txt(cookies: &[Cookie]) -> String {
    let mut out = String::from(
        "# Netscape HTTP Cookie File\n# Written by MUN15H for yt-dlp.\n\
         # These are the cookies of the sign-in profile this app made.\n",
    );
    for cookie in cookies {
        let domain = cookie.domain.trim_start_matches('.');
        let include_subdomains = if cookie.domain.starts_with('.') {
            "TRUE"
        } else {
            "FALSE"
        };
        let path = if cookie.path.is_empty() {
            "/"
        } else {
            &cookie.path
        };
        let secure = if cookie.secure { "TRUE" } else { "FALSE" };
        let expires = if cookie.expires > 0.0 {
            cookie.expires as i64
        } else {
            0
        };
        out.push_str(&format!(
            "{domain}\t{include_subdomains}\t{path}\t{secure}\t{expires}\t{}\t{}\n",
            cookie.name, cookie.value
        ));
    }
    out
}

/// Where the session is kept between runs.
pub fn session_path(app_data: &std::path::Path) -> PathBuf {
    app_data.join("yt-session.json")
}

/// Write the session down.
///
/// The session holds the cookies, so the file is written with the
/// permissions only the user can read, and it is in the app's own state
/// folder — not somewhere the user would not expect.
pub fn save_session(app_data: &std::path::Path, session: &Session) -> Result<(), String> {
    let path = session_path(app_data);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not make the state folder: {e}"))?;
    }
    let json = serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("could not save the session: {e}"))?;
    restrict_permissions(&path);
    Ok(())
}

/// Read the session back.
pub fn load_session(app_data: &std::path::Path) -> Option<Session> {
    let path = session_path(app_data);
    let bytes = std::fs::read(path).ok()?;
    let session: Session = serde_json::from_slice(&bytes).ok()?;
    /* A session with no cookies is not a session. */
    if session.cookies.is_empty() {
        return None;
    }
    /* A session that has expired is not a session either. */
    if session.is_expired() {
        return None;
    }
    Some(session)
}

/// Forget the session.
pub fn forget_session(app_data: &std::path::Path) {
    let _ = std::fs::remove_file(session_path(app_data));
}

/// Restrict a file to the user, on the systems that can.
fn restrict_permissions(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(windows)]
    {
        /* On Windows the file lives in the user's own AppData folder,
         * which is already only theirs. */
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(name: &str, value: &str, domain: &str) -> Cookie {
        Cookie {
            name: name.into(),
            value: value.into(),
            domain: domain.into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            expires: 0.0,
            session: true,
        }
    }

    #[test]
    fn the_cookies_file_is_the_netscape_format() {
        let cookies = vec![cookie("SAPISID", "SEED", ".youtube.com")];
        let text = as_cookies_txt(&cookies);
        let line = text.lines().last().unwrap();
        /* domain, include-subdomains, path, secure, expires, name, value */
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(fields.len(), 7);
        assert_eq!(fields[0], "youtube.com");
        assert_eq!(fields[1], "TRUE");
        assert_eq!(fields[2], "/");
        assert_eq!(fields[3], "TRUE");
        assert_eq!(fields[4], "0");
        assert_eq!(fields[5], "SAPISID");
        assert_eq!(fields[6], "SEED");
    }

    #[test]
    fn a_session_with_no_cookies_is_not_loaded() {
        let dir = std::env::temp_dir().join(format!("mun15h-sess-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        /* No file at all. */
        assert!(load_session(&dir).is_none());
        /* A file with an empty session. */
        std::fs::write(
            session_path(&dir),
            serde_json::to_vec(&Session::default()).unwrap(),
        )
        .unwrap();
        assert!(load_session(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
