//! The YouTube session: the cookies, the signing, and who is signed in.
//!
//! # Why a raw cookie is not enough
//!
//! This is the part that catches people out. Sending the cookies in a
//! `Cookie:` header is *not* enough for YouTube's own API. Google expects
//! a second, signed header:
//!
//! ```text
//! Authorization: SAPISIDHASH <timestamp>_<sha1(timestamp + " " + SAPISID + " " + origin)>
//! ```
//!
//! Without it, the request is treated as anonymous: the library is empty,
//! the playlists are missing, and the player refuses to hand over the
//! streams.
//!
//! # Which login
//!
//! A browser can hold **ten** Google logins at once. The one to use is
//! chosen with `X-Goog-AuthUser` — the index of the login in the jar,
//! which is *not* the same as the index of the account in the list. The
//! session works this out by asking YouTube which logins are live, and
//! remembering the answer.
//!
//! # The brand channel
//!
//! A login can be the user, or one of their brand channels. The channel is
//! chosen with `X-Goog-PageId`. Sending the wrong one is worse than
//! sending none.

use std::time::{SystemTime, UNIX_EPOCH};

use sha1::{Digest, Sha1};
use std::collections::HashMap;

use super::cdp::{as_cookie_header, value_of, Cookie};

/// The music origin. The signature is made for *this* origin.
pub const MUSIC_ORIGIN: &str = "https://music.youtube.com";

/// The web origin. A signature made for the music origin is not valid
/// for this one, and the other way round.
#[cfg(test)]
pub const WEB_ORIGIN: &str = "https://www.youtube.com";

/// The YouTube Music web client.
pub const WEB_REMIX_CLIENT_ID: &str = "67";

/// The client version. YouTube checks this against the real one, so a
/// stale version gets refused; this one is refreshed from the live page
/// when the session is made.
pub const WEB_REMIX_CLIENT_VERSION: &str = "1.20250101.01.00";

/// A signed-in YouTube Music session.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// The cookies, as the browser gave them.
    pub cookies: Vec<Cookie>,
    /// Which login to use, as the index in the browser's jar.
    pub auth_user: Option<String>,
    /// Which brand channel to use.
    pub page_id: Option<String>,
    /// The visitor id, which the player request needs.
    pub visitor_data: Option<String>,
    /// The account's own channel id.
    pub channel_id: Option<String>,
    /// The account's name, for the settings screen.
    pub account_name: Option<String>,
    /// The account's email address, for the settings screen.
    pub email: Option<String>,
    /// Whether the account has YouTube Music Premium.
    ///
    /// This is what decides whether the streams are ad-free.
    pub premium: Option<bool>,
    /// When the session was made, in seconds since the epoch. A session
    /// has a shelf life even before the cookies expire.
    pub made_at: u64,
}

impl Session {
    /// How long a session is considered fresh, in seconds.
    ///
    /// The cookies live longer than this, but the *login index* and the
    /// channel can go stale, and a stale index is the kind of thing that
    /// produces baffling failures much later. A day is a compromise: long
    /// enough not to be a nuisance, short enough to notice when it goes.
    pub const MAX_AGE_SECS: u64 = 24 * 60 * 60;

    /// Is there a session at all?
    pub fn is_signed_in(&self) -> bool {
        self.sap().is_some()
    }

    /// Has the session gone stale?
    pub fn is_expired(&self) -> bool {
        if self.made_at == 0 {
            return false;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        now.saturating_sub(self.made_at) > Self::MAX_AGE_SECS
    }

    /// The moment the session was made, in seconds since the epoch.
    pub fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// The `SAPISID` cookie — the seed of the signature.
    pub fn sap(&self) -> Option<String> {
        value_of(&self.cookies, "SAPISID")
            .or_else(|| value_of(&self.cookies, "__Secure-3PAPISID"))
    }

    /// The cookies as a `Cookie:` header.
    pub fn cookie_header(&self) -> String {
        as_cookie_header(&self.cookies)
    }

        /// The `Authorization` header for a request to an origin.
    ///
    /// The scheme is chosen by the cookie that is present: `SAPISIDHASH`
    /// for the old one, `SAPISID1PHASH` for the newer `__Secure-1PSID`,
    /// and `SAPISID3PHASH` for `__Secure-3PSID`.
    pub fn authorization(&self, origin: &str) -> Option<String> {
        let (scheme, seed) = if let Some(seed) = value_of(&self.cookies, "__Secure-3PSID") {
            ("SAPISID3PHASH", seed)
        } else if let Some(seed) = value_of(&self.cookies, "__Secure-1PSID") {
            ("SAPISID1PHASH", seed)
        } else if let Some(seed) = value_of(&self.cookies, "SAPISID") {
            ("SAPISIDHASH", seed)
        } else {
            return None;
        };

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
            .to_string();

        /* sha1(timestamp + " " + seed + " " + origin) */
        let mut hasher = Sha1::new();
        hasher.update(timestamp.as_bytes());
        hasher.update(b" ");
        hasher.update(seed.as_bytes());
        hasher.update(b" ");
        hasher.update(origin.as_bytes());
        let hash = hasher.finalize();
        let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();

        Some(format!("{scheme} {timestamp}_{hex}"))
    }

    /// The headers every signed request needs.
    pub fn signed_headers(&self, origin: &str) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        if let Some(auth) = self.authorization(origin) {
            headers.insert("Authorization".to_string(), auth);
        }
        if let Some(user) = &self.auth_user {
            headers.insert("X-Goog-AuthUser".to_string(), user.clone());
        }
        if let Some(page_id) = &self.page_id {
            headers.insert("X-Goog-PageId".to_string(), page_id.clone());
        }
        headers.insert("X-Origin".to_string(), origin.to_string());
        headers
    }

    /// The request body every InnerTube call needs.
    ///
    /// The `context` is what tells YouTube which client is talking. The
    /// `user` is empty: the *account* is chosen by the header, not by the
    /// body.
    pub fn innertube_context(&self) -> serde_json::Value {
        let mut client = serde_json::json!({
            "clientName": "WEB_REMIX",
            "clientVersion": WEB_REMIX_CLIENT_VERSION,
            "hl": "en",
            "gl": "US",
        });
        if let Some(visitor) = &self.visitor_data {
            client["visitorData"] = serde_json::Value::String(visitor.clone());
        }
        serde_json::json!({
            "context": { "client": client, "user": {} },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(name: &str, value: &str) -> Cookie {
        Cookie {
            name: name.into(),
            value: value.into(),
            domain: ".youtube.com".into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            expires: 0.0,
            session: true,
        }
    }

    #[test]
    fn the_signature_is_the_documented_shape() {
        let session = Session {
            cookies: vec![cookie("SAPISID", "SEED")],
            ..Default::default()
        };
        let auth = session.authorization(MUSIC_ORIGIN).unwrap();
        /* "SAPISIDHASH <timestamp>_<40 hex characters>" */
        let (scheme, rest) = auth.split_once(' ').unwrap();
        assert_eq!(scheme, "SAPISIDHASH");
        let (timestamp, hash) = rest.split_once('_').unwrap();
        assert!(timestamp.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(hash.len(), 40);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn the_signature_depends_on_the_origin() {
        let session = Session {
            cookies: vec![cookie("SAPISID", "SEED")],
            ..Default::default()
        };
        /* The hash is made over the origin, so two origins give two
         * different signatures for the same second. */
        let a = session.authorization(MUSIC_ORIGIN).unwrap();
        let b = session.authorization(WEB_ORIGIN).unwrap();
        let hash_of = |s: &str| s.split_once('_').unwrap().1.to_string();
        assert_ne!(hash_of(&a), hash_of(&b));
    }

    #[test]
    fn the_newer_cookie_picks_the_newer_scheme() {
        let session = Session {
            cookies: vec![cookie("__Secure-3PSID", "SEED")],
            ..Default::default()
        };
        assert!(session
            .authorization(MUSIC_ORIGIN)
            .unwrap()
            .starts_with("SAPISID3PHASH "));
    }

    #[test]
    fn no_cookie_means_no_signature() {
        let session = Session::default();
        assert!(session.authorization(MUSIC_ORIGIN).is_none());
        assert!(!session.is_signed_in());
    }

    #[test]
    fn the_signed_headers_carry_the_identity() {
        let session = Session {
            cookies: vec![cookie("SAPISID", "SEED")],
            auth_user: Some("2".into()),
            page_id: Some("UC123".into()),
            ..Default::default()
        };
        let headers = session.signed_headers(MUSIC_ORIGIN);
        assert_eq!(headers.get("X-Goog-AuthUser").unwrap(), "2");
        assert_eq!(headers.get("X-Goog-PageId").unwrap(), "UC123");
        assert_eq!(headers.get("X-Origin").unwrap(), MUSIC_ORIGIN);
        assert!(headers.contains_key("Authorization"));
    }

    #[test]
    fn the_context_names_the_music_client() {
        let session = Session {
            visitor_data: Some("VISITOR".into()),
            ..Default::default()
        };
        let context = session.innertube_context();
        assert_eq!(context["context"]["client"]["clientName"], "WEB_REMIX");
        assert_eq!(context["context"]["client"]["visitorData"], "VISITOR");
        /* The account is chosen by the header, never by the body. */
        assert!(context["context"]["user"].is_object());
        assert_eq!(context["context"]["user"].as_object().unwrap().len(), 0);
    }
}
