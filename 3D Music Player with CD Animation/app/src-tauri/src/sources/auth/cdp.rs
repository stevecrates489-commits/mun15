//! Asking the browser about its cookies, over the DevTools Protocol.
//!
//! This is the browser's **own supported interface** for the question
//! "what cookies do you have". It is not a database read, not a key
//! decryption, and not a scraping of a locked file — the browser is asked,
//! and it answers.
//!
//! The command is [`Storage.getCookies`], which works at the **browser**
//! level (not a tab level), so it returns the cookies for every site the
//! browser has.
//!
//! [`Storage.getCookies`]: https://chromedevtools.github.io/devtools-protocol/tot/Storage/#method-getCookies

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

/// One cookie, as the browser describes it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub secure: bool,
    #[serde(default)]
    pub http_only: bool,
    /// When it expires, in seconds since the epoch. Zero means a session
    /// cookie — one that lasts until the browser is closed.
    #[serde(default)]
    pub expires: f64,
    #[serde(default)]
    pub session: bool,
}

/// A CDP client, talking to one browser.
pub struct Cdp {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    next_id: u64,
}

impl Cdp {
    /// Connect to the browser's debugging socket.
    pub async fn connect(url: &str) -> Result<Self, String> {
        let (socket, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|e| format!("could not talk to the browser: {e}"))?;
        Ok(Self {
            socket,
            next_id: 1,
        })
    }

    /// Send a command and wait for its answer.
    ///
    /// The protocol is a stream of JSON messages, and the answers can come
    /// back in any order, so the one with the matching id is the one that
    /// matters. Events (which have no id) are stepped over.
    pub async fn call(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });
        self.socket
            .send(Message::Text(request.to_string().into()))
            .await
            .map_err(|e| format!("could not send to the browser: {e}"))?;

        /* A long wait is fine: the browser is idle while the user signs
         * in, and the answer to `Storage.getCookies` comes the moment it
         * is asked. */
        for _ in 0..500 {
            let Some(Ok(message)) = self.socket.next().await else {
                return Err("the browser closed the connection".into());
            };
            let Message::Text(text) = message else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(text.as_str()) else {
                continue;
            };
            /* Only the answer to this call. */
            if value.get("id").and_then(|v| v.as_u64()) != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("the browser refused");
                return Err(message.to_string());
            }
            return Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null));
        }
        Err("the browser did not answer in time".into())
    }

    /// Every cookie the browser has.
    pub async fn all_cookies(&mut self) -> Result<Vec<Cookie>, String> {
        let result = self
            .call("Storage.getCookies", serde_json::json!({}))
            .await?;
        let cookies = result
            .get("cookies")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(cookies
            .into_iter()
            .filter_map(|c| serde_json::from_value::<Cookie>(c).ok())
            .collect())
    }
}

/// Keep only the cookies that belong to a set of domains.
///
/// The check is on the domain *suffix*, with a dot in front, so
/// `youtube.com` matches `music.youtube.com` and `.youtube.com` but not
/// `notyoutube.com`.
pub fn cookies_for(cookies: &[Cookie], domains: &[&str]) -> Vec<Cookie> {
    cookies
        .iter()
        .filter(|cookie| {
            let domain = cookie.domain.trim_start_matches('.').to_lowercase();
            domains.iter().any(|wanted| {
                let wanted = wanted.trim_start_matches('.').to_lowercase();
                domain == wanted || domain.ends_with(&format!(".{wanted}"))
            })
        })
        .cloned()
        .collect()
}

/// The cookies as a header, ready to send.
pub fn as_cookie_header(cookies: &[Cookie]) -> String {
    cookies
        .iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// The name of a cookie, if there is one.
pub fn value_of(cookies: &[Cookie], name: &str) -> Option<String> {
    cookies
        .iter()
        .find(|c| c.name == name)
        .map(|c| c.value.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(name: &str, domain: &str) -> Cookie {
        Cookie {
            name: name.into(),
            value: "v".into(),
            domain: domain.into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            expires: 0.0,
            session: true,
        }
    }

    #[test]
    fn the_domain_check_is_a_suffix_check() {
        let all = vec![
            cookie("SAPISID", ".youtube.com"),
            cookie("SID", ".google.com"),
            cookie("EVIL", "notyoutube.com"),
        ];
        let kept = cookies_for(&all, &["youtube.com"]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].name, "SAPISID");
    }

    #[test]
    fn the_cookie_header_is_joined_with_semicolons() {
        let all = vec![cookie("a", "youtube.com"), cookie("b", "youtube.com")];
        let header = as_cookie_header(&all);
        assert_eq!(header, "a=v; b=v");
    }

    #[test]
    fn a_cookie_can_be_looked_up() {
        let all = vec![cookie("SAPISID", ".youtube.com")];
        assert_eq!(value_of(&all, "SAPISID").as_deref(), Some("v"));
        assert_eq!(value_of(&all, "MISSING"), None);
    }
}
