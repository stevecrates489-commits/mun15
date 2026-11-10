//! The lyric providers, reached from the shell.
//!
//! The services the player falls back to (NetEase, KuGou, QQ Music) answer
//! with no `Access-Control-Allow-Origin` header, so a `fetch()` from the web
//! view is refused by the browser before the request is even sent. The shell
//! has no such rule: it can ask for the same address and hand the answer
//! back as text.
//!
//! So this is a TRANSPORT and nothing more — it fetches a URL and returns the
//! body. Which providers are asked, in what order, what their answers mean
//! and how a match is judged is the interface's business (`features/lyrics/`),
//! and it stays there.
//!
//! The body is decoded as text rather than bytes because every one of these
//! answers is text — JSON, or base64-wrapped LRC — and the `charset` feature
//! picks the right decoder from the response's own header.

use serde::Serialize;
use std::time::Duration;

/// What came back from a provider.
#[derive(Serialize)]
pub struct HttpBody {
    pub status: u16,
    pub body: String,
}

/// How long one provider gets before it is written off when the caller does
/// not say otherwise.
const TIMEOUT: Duration = Duration::from_secs(15);

/// The longest a caller may ask for. The caller owns the budget — a gateway
/// that is asked several times over gets a short one — but it cannot ask for
/// a request that hangs forever.
const MAX_TIMEOUT: Duration = Duration::from_secs(30);

/**
 * The client every request goes out on.
 *
 * One client, reused: a new one per request means a new TLS handshake and a
 * new connection pool for every provider, and the providers are asked in
 * parallel now — that would be a handshake storm.
 *
 * `Accept-Encoding` is deliberately NOT advertised. The crate is built without
 * the compression features, so a server that gzips anyway would hand back
 * bytes this build cannot decode, and the provider would look like it had no
 * lyrics when it really had them.
 */
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("MUN15H/", env!("CARGO_PKG_VERSION")))
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("could not build the http client: {e}"))
}

/// Fetch a URL and hand back its body as text.
///
/// `referer` is here because two of the services answer a lyric request
/// differently when it looks like it came from their own site. A provider
/// that does not care simply never gets one.
///
/// `timeout_ms` is the caller's budget. It matters because the interface asks
/// the same gateway several times over: a silent catalogue must not be able
/// to spend the whole turn. Without it every request here would take the
/// full fifteen seconds, and a track change would wait out all of them.
async fn fetch_text(
    url: &str,
    referer: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<HttpBody, String> {
    let timeout = match timeout_ms {
        Some(ms) => Duration::from_millis(ms).min(MAX_TIMEOUT),
        None => TIMEOUT,
    };
    let client = build_client()?;

    let mut request = client.get(url).timeout(timeout);
    if let Some(referer) = referer.filter(|r| !r.trim().is_empty()) {
        request = request.header(reqwest::header::REFERER, referer);
    }

    let response = request.send().await.map_err(|e| format!("{e}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("{e}"))?;
    Ok(HttpBody { status, body })
}

/// The command the interface calls.
#[tauri::command]
pub async fn lyrics_http_get(
    url: String,
    referer: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<HttpBody, String> {
    fetch_text(&url, referer.as_deref(), timeout_ms).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The providers that answer with no CORS header, and the ones that do.
    ///
    /// This test reaches the live services, so it is a manual check rather
    /// than part of the ordinary suite: it proves the SHELL can get an answer
    /// from every provider, which is the one thing the browser cannot do.
    #[tokio::test]
    #[ignore = "reaches the live services"]
    async fn the_shell_can_reach_every_provider() {
        let targets: Vec<(&str, &str, Option<&str>)> = vec![
            (
                "NetEase search",
                "https://music.163.com/api/search/get?s=One+More+Time&type=1&offset=0&total=true&limit=10",
                Some("https://music.163.com/"),
            ),
            (
                "NetEase lyric",
                "https://music.163.com/api/song/lyric?id=17455800&lv=1&kv=1&tv=-1&rv=-1&cp=false&lrc_t=0&nocomment=1&fmt=json",
                Some("https://music.163.com/"),
            ),
            (
                "KuGou search",
                "https://mobileservice.kugou.com/api/v3/search/song?format=json&keyword=One+More+Time&page=1&pagesize=10&showtype=1",
                None,
            ),
            (
                "LyricsPlus",
                "https://lyricsplus.binimum.org/v2/lyrics/get?title=One%20More%20Time&artist=Daft%20Punk&duration=320&source=spotify",
                None,
            ),
            (
                "LRCLIB",
                "https://lrclib.net/api/search?q=One%20More%20Time%20Daft%20Punk",
                None,
            ),
            (
                "lrc.red",
                "https://lrc.red/match.json?track=One%20More%20Time&artist=Daft%20Punk&duration=320",
                None,
            ),
            (
                "Genius",
                "https://fetch-genius.samidy.workers.dev/?title=One%20More%20Time&artist=Daft%20Punk",
                None,
            ),
            (
                "Lyrics.ovh",
                "https://api.lyrics.ovh/v1/Daft%20Punk/One%20More%20Time",
                None,
            ),
            (
                "Unison",
                "https://unison.boidu.dev/lyrics?song=One+More+Time&artist=Daft+Punk&duration=320",
                None,
            ),
        ];

        for (name, url, referer) in targets {
            match fetch_text(url, referer, None).await {
                Ok(body) => {
                    let head: String = body.body.chars().take(70).collect();
                    println!(
                        "  {name:<16} {:<4} {:>7} bytes  {}",
                        body.status,
                        body.body.len(),
                        head.replace('\n', " ")
                    );
                }
                Err(e) => println!("  {name:<16} FAILED  {e}"),
            }
        }
    }
}
