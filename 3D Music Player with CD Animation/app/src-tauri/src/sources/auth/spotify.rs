//! Spotify — signing in, the official way.
//!
//! # Spotify cannot be done with YouTube's cookies
//!
//! They are different services with different accounts. A Google cookie
//! means nothing to Spotify. So Spotify gets its own sign-in, and it is
//! the one Spotify designed: **OAuth 2.0, Authorization Code, with PKCE**.
//!
//! The flow:
//!
//! 1. The app makes a code verifier and its SHA-256 challenge.
//! 2. The system browser opens on Spotify's authorize page, with the
//!    challenge in it.
//! 3. The user signs in and approves.
//! 4. Spotify redirects to `http://127.0.0.1:<port>/callback` with a
//!    code. The app is already listening there.
//! 5. The app exchanges the code for an access token and a refresh
//!    token, using the verifier.
//!
//! No client secret is involved, and none is needed: PKCE exists so that
//! a public client — which is what a desktop app is — can do this safely.
//!
//! # What Spotify's API does and does not give
//!
//! It gives **metadata**: search, playlists, the library, the player's
//! state. It does **not** give audio addresses. The `preview_url` field
//! is deprecated and usually empty, and no endpoint returns a playable
//! file.
//!
//! Playing Spotify audio inside a third-party app needs the **Web
//! Playback SDK**, which:
//!
//! - requires the user to have **Premium**,
//! - is restricted to **non-commercial** use,
//! - and renders the audio itself, so it does not go through this app's
//!   audio engine — it cannot be analysed by the visualiser, and it does
//!   not appear in the local library.
//!
//! So the Spotify adapter here does the honest half: it signs in, it
//! searches, and it lists. See the docs for the rest.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};


/// A Spotify access token and, if it came with one, a refresh token.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// When the access token runs out, in seconds since the epoch.
    #[serde(default)]
    pub expires_at: u64,
    #[serde(default)]
    pub scope: Option<String>,
}

impl SpotifyTokens {
    /// Is the access token still good?
    pub fn is_valid(&self) -> bool {
        !self.access_token.is_empty() && self.expires_at > now_secs()
    }

    /// The access token, refreshed if it has expired.
    ///
    /// The refresh token is long-lived, so the user does not have to sign
    /// in again every hour.
    pub async fn fresh_access_token(
        &self,
        client_id: &str,
    ) -> Result<String, String> {
        if self.is_valid() {
            return Ok(self.access_token.clone());
        }
        let Some(refresh) = self.refresh_token.as_ref() else {
            return Err("the Spotify session has expired — sign in again".into());
        };
        let body = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id),
        ];
        let response = reqwest::Client::new()
            .post("https://accounts.spotify.com/api/token")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(
                body.iter()
                    .map(|(k, v)| format!("{}={}", k, urlencode(v)))
                    .collect::<Vec<_>>()
                    .join("&"),
            )
            .send()
            .await
            .map_err(|e| format!("could not reach Spotify: {e}"))?;
        if !response.status().is_success() {
            return Err("Spotify would not refresh the session — sign in again".into());
        }
        let answer: RefreshAnswer = response
            .json()
            .await
            .map_err(|e| format!("Spotify said something odd: {e}"))?;
        let _ = (answer.expires_in, answer.scope);
        Ok(answer.access_token)
    }
}

#[derive(Debug, Deserialize)]
struct RefreshAnswer {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    scope: Option<String>,
}

/// A sign-in that is in progress.
pub struct SpotifySignIn {
    /// The client id, from the Spotify developer dashboard.
    pub client_id: String,
    /// The PKCE code verifier.
    pub verifier: String,
    /// Where the callback is expected to come back to.
    pub redirect: String,
    /// Where the browser should be sent.
    pub authorize_url: String,
}

/// Start a Spotify sign-in.
///
/// The client id comes from the Spotify developer dashboard. There is no
/// way around that: Spotify does not hand out client ids to anyone who
/// asks, and the app will not work without one.
pub fn start(client_id: &str, port: u16) -> Result<SpotifySignIn, String> {
    if client_id.trim().is_empty() {
        return Err(
            "no Spotify client id — make an app at developer.spotify.com and put its id in the settings"
                .into(),
        );
    }
    let verifier = random_verifier();
    let challenge = pkce_challenge(&verifier);
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let state = random_verifier();

    let url = format!(
        "https://accounts.spotify.com/authorize\
         ?client_id={}\
         &response_type=code\
         &redirect_uri={}\
         &code_challenge_method=S256\
         &code_challenge={}\
         &state={}\
         &scope=user-read-private%20user-read-email%20playlist-read-private%20playlist-read-collaborative%20library-read",
        urlencode(client_id),
        urlencode(&redirect),
        urlencode(&challenge),
        urlencode(&state)
    );

    Ok(SpotifySignIn {
        client_id: client_id.to_string(),
        verifier,
        authorize_url: url,
        redirect,
    })
}

/// Exchange the code Spotify redirected with, for a token.
pub async fn finish(
    client_id: &str,
    verifier: &str,
    code: &str,
    redirect: &str,
) -> Result<SpotifyTokens, String> {
    let body = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];
    let response = reqwest::Client::new()
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(
            body.iter()
                .map(|(k, v)| format!("{}={}", k, urlencode(v)))
                .collect::<Vec<_>>()
                .join("&"),
        )
        .send()
        .await
        .map_err(|e| format!("could not reach Spotify: {e}"))?;
    if !response.status().is_success() {
        return Err("Spotify would not give a token — sign in again".into());
    }
    let answer: TokenAnswer = response
        .json()
        .await
        .map_err(|e| format!("Spotify said something odd: {e}"))?;
    Ok(SpotifyTokens {
        access_token: answer.access_token,
        refresh_token: answer.refresh_token,
        expires_at: now_secs() + answer.expires_in.unwrap_or(3600),
        scope: answer.scope,
    })
}

#[derive(Debug, Deserialize)]
struct TokenAnswer {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    scope: Option<String>,
}

/// Where the tokens are kept.
pub fn tokens_path(app_data: &std::path::Path) -> PathBuf {
    app_data.join("spotify-tokens.json")
}

/// Write the tokens down.
pub fn save_tokens(app_data: &std::path::Path, tokens: &SpotifyTokens) -> Result<(), String> {
    let path = tokens_path(app_data);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not make the state folder: {e}"))?;
    }
    let json = serde_json::to_vec_pretty(tokens).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("could not save the session: {e}"))?;
    Ok(())
}

/// Read the tokens back.
pub fn load_tokens(app_data: &std::path::Path) -> Option<SpotifyTokens> {
    let bytes = std::fs::read(tokens_path(app_data)).ok()?;
    let tokens: SpotifyTokens = serde_json::from_slice(&bytes).ok()?;
    if tokens.access_token.is_empty() {
        return None;
    }
    Some(tokens)
}

/// Forget the tokens.
pub fn forget_tokens(app_data: &std::path::Path) {
    let _ = std::fs::remove_file(tokens_path(app_data));
}

/// A random string for the verifier and the state.
///
/// It has to be unguessable, because it is what proves the callback came
/// from the request this app made.
fn random_verifier() -> String {
    let mut bytes = [0u8; 32];
    let _ = getrandom::fill(&mut bytes);
    base64_url(&bytes)
}

/// The PKCE challenge: the base64url of the SHA-256 of the verifier.
fn pkce_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64_url(&hasher.finalize())
}

/// Base64, url-safe, without the padding.
fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4 + 2) / 3);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((triple >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 63) as usize] as char);
        }
    }
    out
}

/// Percent-encode a query for a URL.
fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Seconds since the epoch.
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_base64_alphabet_is_the_url_safe_one() {
        /* The bytes that differ between the two alphabets. */
        assert_eq!(base64_url(&[0xfb, 0xff]), "-_8");
        assert_eq!(base64_url(&[0x00]), "AA");
    }

    #[test]
    fn the_verifier_is_long_and_different_each_time() {
        let a = random_verifier();
        let b = random_verifier();
        assert!(a.len() >= 40);
        assert_ne!(a, b);
    }

    #[test]
    fn the_challenge_is_the_hash_of_the_verifier() {
        /* The RFC 7636 example: the verifier and its challenge. */
        let challenge = pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn a_token_with_no_access_token_is_not_valid() {
        let tokens = SpotifyTokens::default();
        assert!(!tokens.is_valid());
    }
}
