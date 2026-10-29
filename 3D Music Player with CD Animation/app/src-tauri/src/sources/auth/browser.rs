//! Finding a browser and giving it a profile of its own.
//!
//! # Why a profile of its own
//!
//! The user signs in to YouTube Music somewhere. The obvious place is the
//! browser they already use. But there are two problems with that:
//!
//! 1. **Chrome's App-Bound Encryption** ties the cookies in your everyday
//!    profile to *Chrome itself*. Another program — including this one —
//!    cannot decrypt them. That is a deliberate safety measure, and it is
//!    also why reading a normal profile's cookies does not work any more.
//! 2. Even where it works, taking the cookies out of the profile the user
//!    browses with is a bigger reach than it needs to be.
//!
//! So this gives the browser a **profile of its own**, in the app's own
//! folder. The user signs in there. It is a real sign-in, in a real
//! browser, with the real password box — nothing is scraped and nothing is
//! typed on the user's behalf.
//!
//! The cookies are then read back through the **Chrome DevTools
//! Protocol**, which is the browser's own supported interface for asking
//! about its state. No database is opened, no key is decrypted, and no
//! encryption is undone.
//!
//! The profile belongs to this app. It is not the user's browsing history,
//! and the app never looks at anything in it except the YouTube cookies.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// A browser this app knows how to drive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Browser {
    /// The name to show the user.
    pub name: &'static str,
    /// The program itself.
    pub program: PathBuf,
}

/// The browsers this app knows about, in the order they are offered.
///
/// Brave is first because it is the one that blocks the trackers and the
/// ads that a sign-in page otherwise collects. Chrome, then Edge, then
/// Vivaldi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserChoice {
    /// The first one found, in the order below.
    Automatic,
    Brave,
    Chrome,
    Edge,
    Vivaldi,
}

impl BrowserChoice {
    /// The id used in the settings file.
    pub fn as_str(self) -> &'static str {
        match self {
            BrowserChoice::Automatic => "automatic",
            BrowserChoice::Brave => "brave",
            BrowserChoice::Chrome => "chrome",
            BrowserChoice::Edge => "edge",
            BrowserChoice::Vivaldi => "vivaldi",
        }
    }

    /// From the id in the settings file.
    pub fn from_str(text: &str) -> BrowserChoice {
        match text.trim().to_lowercase().as_str() {
            "brave" => BrowserChoice::Brave,
            "chrome" => BrowserChoice::Chrome,
            "edge" => BrowserChoice::Edge,
            "vivaldi" => BrowserChoice::Vivaldi,
            _ => BrowserChoice::Automatic,
        }
    }

    /// The name to show the user.
    pub fn label(self) -> &'static str {
        match self {
            BrowserChoice::Automatic => "THE FIRST ONE FOUND",
            BrowserChoice::Brave => "BRAVE",
            BrowserChoice::Chrome => "CHROME",
            BrowserChoice::Edge => "EDGE",
            BrowserChoice::Vivaldi => "VIVALDI",
        }
    }
}

/// Where the browsers usually live.
///
/// Both the machine-wide install and the per-user one are looked for,
/// because a per-user install is just as common.
#[cfg(target_os = "windows")]
const KNOWN_BROWSERS: &[(&str, &[&str])] = &[
    (
        "Brave",
        &[
            r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        ],
    ),
    (
        "Chrome",
        &[
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ],
    ),
    (
        "Edge",
        &[
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ],
    ),
    (
        "Vivaldi",
        &[
            r"C:\Program Files\Vivaldi\Application\vivaldi.exe",
            r"C:\Program Files (x86)\Vivaldi\Application\vivaldi.exe",
        ],
    ),
];

#[cfg(not(target_os = "windows"))]
const KNOWN_BROWSERS: &[(&str, &[&str])] = &[];

/// The per-user install folder, where a browser installed for one account
/// puts itself.
#[cfg(target_os = "windows")]
fn local_app_data() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA").ok().map(PathBuf::from)
}

#[cfg(not(target_os = "windows"))]
fn local_app_data() -> Option<PathBuf> {
    std::env::var("XDG_DATA_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local/share")))
}

impl Browser {
    /// Every browser found on this machine, in the order they are offered.
    pub fn find_all() -> Vec<Browser> {
        let mut found: Vec<Browser> = Vec::new();
        let mut add = |name: &'static str, path: PathBuf| {
            if path.exists() && !found.iter().any(|b| b.program == path) {
                found.push(Browser { name, program: path });
            }
        };

        for (name, paths) in KNOWN_BROWSERS {
            for path in *paths {
                add(name, PathBuf::from(path));
            }
            /* The per-user install, under the local app data folder. */
            if let Some(local) = local_app_data() {
                /* The folder layout is the same, under LOCALAPPDATA. */
                let relative = match *name {
                    "Brave" => r"BraveSoftware\Brave-Browser\Application\brave.exe",
                    "Chrome" => r"Google\Chrome\Application\chrome.exe",
                    "Edge" => r"Microsoft\Edge\Application\msedge.exe",
                    "Vivaldi" => r"Vivaldi\Application\vivaldi.exe",
                    _ => "",
                };
                if !relative.is_empty() {
                    add(name, local.join(relative));
                }
            }
        }

        /* And on the PATH, which is how a portable install would be
         * found. */
        for (name, program) in [
            ("Brave", "brave"),
            ("Chrome", "chrome"),
            ("Edge", "msedge"),
            ("Vivaldi", "vivaldi"),
        ] {
            if let Some(path) = which(program) {
                add(name, PathBuf::from(path));
            }
        }
        found
    }

    /// The browser that should be used, given the user's choice.
    ///
    /// A choice that is not installed is not silently swapped for another
    /// one: the user is told which browser was asked for and which was
    /// used, because signing in to the wrong browser is confusing.
    pub fn find(choice: BrowserChoice) -> Result<Browser, String> {
        let all = Browser::find_all();
        if all.is_empty() {
            return Err(
                "no browser was found — Brave, Chrome, Edge or Vivaldi would all do".to_string(),
            );
        }
        match choice {
            BrowserChoice::Automatic => Ok(all[0].clone()),
            other => {
                let wanted = other.as_str();
                all.iter()
                    .find(|b| b.name.to_lowercase() == wanted)
                    .cloned()
                    .ok_or_else(|| {
                        format!(
                            "{} is not installed — the app found {}",
                            other.label(),
                            all.iter()
                                .map(|b| b.name)
                                .collect::<Vec<_>>()
                                .join(", ")
                        )
                    })
            }
        }
    }

    /// Launch the browser on a profile of its own, opening a page.
    ///
    /// # The debugging interface is deliberately NOT enabled here
    ///
    /// A browser started with `--remote-debugging-port` sets
    /// `navigator.webdriver` to `true`, and Google checks that on the
    /// sign-in page: it answers
    /// `accounts.google.com/v3/signin/rejected` with *"This browser or app
    /// may not be secure"*. The reason is sensible — a debugging-enabled
    /// browser is one an automated tool could drive, and letting it sign
    /// in would let that tool take the session.
    ///
    /// So the sign-in happens in an ordinary browser, with no debugging
    /// flags at all, and the cookies are read afterwards by
    /// [`Browser::launch_headless`] — a second launch of the *same*
    /// profile, by which time the sign-in has already happened and
    /// Google has no reason to care.
    ///
    /// The page is given on the command line rather than opened later
    /// over the debugging protocol: the browser shows the right thing
    /// immediately, and the protocol is only needed for the cookies.
    pub fn launch_for_sign_in(
        &self,
        profile: &Path,
        url: &str,
    ) -> Result<Launched, String> {
        let mut command = self.command_for(profile, url);
        command.arg(url);
        let child = command
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", self.program.display()))?;

        Ok(Launched {
            browser: self.clone(),
            profile: profile.to_path_buf(),
            pid: child.id(),
            child: Some(child),
        })
    }

    /// Relaunch the same profile, headless, with the debugging interface
    /// on — and read the cookies from it.
    ///
    /// This is the second half of the sign-in, and it is why the sign-in
    /// itself can happen in an ordinary browser. By the time this runs,
    /// the user is already signed in; the debugging interface is only
    /// used to ask the browser what cookies it has.
    pub fn launch_headless(&self, profile: &Path) -> Result<Launched, String> {
        /* The file the browser writes its debugging port into. The last
         * run's file is still there, with a port that nothing is
         * listening on — so it is removed first, or the wait below would
         * read a dead port and give up. */
        let port_file = profile.join("DevToolsActivePort");
        let _ = std::fs::remove_file(&port_file);

        let mut command = self.command_for(profile, "about:blank");
        command
            .arg("--headless=new")
            .arg("--remote-debugging-port=0")
            .arg("--remote-debugging-address=127.0.0.1")
            .arg("about:blank");

        let child = command
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", self.program.display()))?;

        Ok(Launched {
            browser: self.clone(),
            profile: profile.to_path_buf(),
            pid: child.id(),
            child: Some(child),
        })
    }

    /// The flags every launch shares.
    ///
    /// Note what is **not** here: `--remote-debugging-port`. See
    /// [`Browser::launch_for_sign_in`].
    fn command_for(&self, profile: &Path, _url: &str) -> Command {
        if let Some(parent) = profile.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut command = Command::new(&self.program);
        command
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--no-service-autorun")
            /* The browser gets closed when the sign-in is done, which is
             * not a crash — but the browser cannot tell the difference,
             * and would offer to restore the session next time. */
            .arg("--disable-session-crashed-bubble")
            .arg("--password-store=basic")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            /* CREATE_NO_WINDOW — a console window would flash up and then
             * sit there for the whole sign-in. */
            command.creation_flags(0x08000000);
        }
        command
    }
}

/// A browser that has been started.
pub struct Launched {
    pub browser: Browser,
    pub profile: PathBuf,
    /// The process id, so that only *this* browser is closed afterwards.
    pub pid: u32,
    /// The process itself, so that it can be waited on and closed
    /// without killing the user's own browser.
    pub child: Option<std::process::Child>,
}

impl Launched {
    /// Has the browser closed?
    pub fn has_exited(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            return true;
        };
        matches!(child.try_wait(), Ok(Some(_)))
    }

    /// Close the browser, and wait a moment for it to go.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
            /* A browser is several processes — the window, the renderer,
             * the GPU. Killing the main one usually takes the rest with
             * it, but not always, and an orphaned renderer would keep
             * the profile locked. So the tree goes too. */
            close(&self.browser, self.pid);
        }
    }

    /// Wait for the browser to write its debugging port.
    ///
    /// Chrome writes `DevToolsActivePort` into the profile as soon as the
    /// debugging interface is up. The file's first line is the port, and
    /// its second line is the path of the browser's own websocket.
    pub async fn wait_for_debugger(&self, timeout: std::time::Duration) -> Result<Debugger, String> {
        let port_file = self.profile.join("DevToolsActivePort");
        let started = std::time::Instant::now();
        loop {
            if let Ok(text) = std::fs::read_to_string(&port_file) {
                let mut lines = text.lines();
                if let Some(port) = lines.next().and_then(|p| p.trim().parse::<u16>().ok()) {
                    /* The port has to be one something is listening on:
                     * the file can be left over from a run that has
                     * since ended. */
                    if is_listening(port) {
                        return Ok(Debugger { port });
                    }
                }
            }
            if started.elapsed() > timeout {
                return Err("the browser did not start its debugging interface in time".into());
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }
}

/// Is something listening on this port?
fn is_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(400),
    )
    .is_ok()
}

/// A browser's debugging interface.
#[derive(Debug, Clone, Copy)]
pub struct Debugger {
    pub port: u16,
}

impl Debugger {
    /// The browser's own websocket, for talking to it at the browser level.
    ///
    /// The browser-level endpoint is the one that can ask about *all* the
    /// cookies, not just a tab's.
    pub async fn browser_websocket(&self) -> Result<String, String> {
        let url = format!("http://127.0.0.1:{}/json/version", self.port);
        let response = reqwest::get(&url)
            .await
            .map_err(|e| format!("could not reach the browser: {e}"))?;
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("the browser said something odd: {e}"))?;
        body.get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "the browser did not offer a debugging socket".to_string())
    }

}

/// Find a program on the PATH.
#[cfg(target_os = "windows")]
fn which(program: &str) -> Option<String> {
    let path = std::env::var("PATH").ok()?;
    let extensions = ["exe", "cmd", "bat", ""];
    for dir in path.split(';').filter(|d| !d.is_empty()) {
        for extension in &extensions {
            let candidate = Path::new(dir).join(format!("{program}.{extension}"));
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn which(program: &str) -> Option<String> {
    let path = std::env::var("PATH").ok()?;
    for dir in path.split(':').filter(|d| !d.is_empty()) {
        let candidate = Path::new(dir).join(program);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// Close a browser that was started for the sign-in.
///
/// **Only the process that was started.** Killing by image name would
/// close the user's own browser, with their own tabs in it.
pub fn close(browser: &Browser, pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = browser;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_browser_is_found_or_none_is_fine() {
        /* There may be no browser on the machine running the tests. Either
         * answer is correct; what matters is that it does not panic. */
        let all = Browser::find_all();
        for browser in &all {
            assert!(browser.program.exists());
            assert!(!browser.name.is_empty());
        }
    }

    #[test]
    fn the_choice_round_trips_through_its_name() {
        for choice in [
            BrowserChoice::Automatic,
            BrowserChoice::Brave,
            BrowserChoice::Chrome,
            BrowserChoice::Edge,
            BrowserChoice::Vivaldi,
        ] {
            assert_eq!(BrowserChoice::from_str(choice.as_str()), choice);
        }
        /* And anything unknown is the automatic one. */
        assert_eq!(
            BrowserChoice::from_str("netscape"),
            BrowserChoice::Automatic
        );
    }

    #[test]
    fn which_finds_nothing_for_a_nonsense_name() {
        assert!(which("definitely-not-a-program-9f3a").is_none());
    }
}
