//! Direct stream resolution — the fast path.
//!
//! # Why this exists
//!
//! `yt-dlp` is a general-purpose extractor. For a YouTube **web** client
//! it has to download the ~2 MB player script and run YouTube's obfuscated
//! signature and `n` challenges through a JavaScript engine. That costs
//! seconds of wall clock on every cold track, and it fails often enough
//! that a track shows up in the list and then will not play.
//!
//! But YouTube only ciphers the *web* clients. A handful of **app**
//! clients get plain `url` fields in their `/player` response: no
//! signature, no `n` transform, no PO token. One JSON POST, and the
//! address is ready.
//!
//! That is what this module does. It is the same trick Dannify uses, and
//! the same one LiMusic and Metrolist worked out.
//!
//! The client table and the request shape come from Dannify's MIT-licensed
//! releases (before 4.13.0), by Daniel Mwendwa — see
//! THIRD-PARTY-NOTICES.md for the notice.
//!
//! # The client identities are the load-bearing part
//!
//! They are what makes YouTube answer with an unciphered address, and
//! they go stale when Google rotates a version. So they live in a table
//! here that can be replaced at runtime — and the whole set is tried in
//! order, because the clients fail for different reasons at different
//! times.
//!
//! # What it does not do
//!
//! It does not work around DRM, and it does not decrypt anything. A
//! protected video is simply not playable, and this says so.

use std::time::Duration;

use serde_json::{json, Value};


/// Where the player request goes.
const PLAYER_URL: &str = "https://music.youtube.com/youtubei/v1/player";

/// The music origin. The signature and the headers are made for it.
const ORIGIN: &str = "https://music.youtube.com";

/// Where a visitor id comes from.
const VISITOR_SOURCE: &str = "https://www.youtube.com/sw.js_data";

/// How long a bootstrapped visitor id is reused.
///
/// It is a soft session marker, not a credential, so a long life is fine
/// — and it saves a round trip on every launch.
const VISITOR_TTL: Duration = Duration::from_secs(12 * 60 * 60);

/// How long one `/player` call may take. These answer in under a second
/// when healthy.
const PLAYER_TIMEOUT: Duration = Duration::from_secs(8);

/// How long the `HEAD` that proves the address will serve bytes may take.
const VALIDATE_TIMEOUT: Duration = Duration::from_secs(6);

/// One client identity.
#[derive(Debug, Clone)]
pub struct Client {
    /// The key in the table.
    pub key: &'static str,
    /// The name YouTube knows this client by.
    pub client_name: &'static str,
    /// The version string.
    pub client_version: &'static str,
    /// The **numeric** client id, which goes in the header.
    pub client_id: &'static str,
    /// The user agent that goes with it.
    pub user_agent: &'static str,
    /// The device fields, when the client has any.
    pub device: Option<(&'static str, &'static str, &'static str, &'static str)>,
    /// The Android SDK version, for the Android clients.
    pub android_sdk: Option<&'static str>,
}

/// The clients whose `/player` answers with plain addresses, in the order
/// they are tried.
///
/// VisionOS is first because it wins essentially every time and carries
/// the full format ladder. The two Android VR builds differ by version on
/// purpose: one of them is usually healthy when the other has been
/// throttled.
pub const CLIENTS: &[Client] = &[
    Client {
        key: "VISIONOS",
        client_name: "VISIONOS",
        client_version: "0.1",
        client_id: "101",
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        device: Some((
            "visionOS",
            "1.3.21O771",
            "Apple",
            "RealityDevice14,1",
        )),
        android_sdk: None,
    },
    Client {
        key: "ANDROID_VR_1_43_32",
        client_name: "ANDROID_VR",
        client_version: "1.43.32",
        client_id: "28",
        user_agent: "com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)",
        device: Some(("Android", "12", "Oculus", "Quest 3")),
        android_sdk: Some("32"),
    },
    Client {
        key: "ANDROID_VR_1_65_10",
        client_name: "ANDROID_VR",
        client_version: "1.65.10",
        client_id: "28",
        user_agent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        device: Some(("Android", "12L", "Oculus", "Quest 3")),
        android_sdk: Some("32"),
    },
];

/// A resolved stream.
#[derive(Debug, Clone)]
pub struct Resolved {
    /// The address. It never leaves this process except through the
    /// loopback server.
    pub url: String,
    /// Which client got it.
    pub client: String,
    /// How long it is, in seconds.
    pub duration_secs: Option<u64>,
    /// The bitrate, in kbps.
    pub bitrate_kbps: Option<u32>,
    /// The container, e.g. `m4a`.
    pub extension: String,
}

impl Resolved {
    /// A line for the log.
    pub fn describe(&self) -> String {
        format!(
            "{} · {} · {}kbps · {}",
            self.client,
            self.extension,
            self.bitrate_kbps.unwrap_or(0),
            self.duration_secs
                .map(|d| format!("{d}s"))
                .unwrap_or_else(|| "live".into())
        )
    }
}

/// The visitor id, and when it was fetched.
pub struct Visitor {
    pub data: String,
    pub at: std::time::Instant,
}

/// Fetch the visitor id, and keep it for a while.
async fn visitor_data(http: &reqwest::Client) -> Option<String> {
    let text = http
        .get(VISITOR_SOURCE)
        .timeout(PLAYER_TIMEOUT)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    parse_visitor(&text)
}

/// Dig the visitor id out of the `sw.js_data` blob.
///
/// The path into that nested array is not documented and has moved before,
/// so it is found by its shape rather than by an index: it is a longish
/// base64-ish token that starts with "Cg".
fn parse_visitor(text: &str) -> Option<String> {
    let trimmed = text.trim_start_matches([')', ']', '}', '\'', '\n', ' ']);
    if let Ok(raw) = serde_json::from_str::<Value>(trimmed) {
        /* The known path, tried first. */
        if let Some(found) = raw
            .get(0)
            .and_then(|a| a.get(2))
            .and_then(|a| a.get(0))
            .and_then(|a| a.get(0))
            .and_then(|a| a.get(13))
            .and_then(|v| v.as_str())
        {
            return Some(found.to_string());
        }
        /* The shape-based rescue. */
        if let Some(found) = find_visitor(&raw) {
            return Some(found);
        }
    }
    None
}

/// Walk a JSON value looking for something that looks like a visitor id.
fn find_visitor(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            if text.len() > 20 && text.starts_with("Cg") {
                Some(text.clone())
            } else {
                None
            }
        }
        Value::Array(items) => items.iter().find_map(find_visitor),
        Value::Object(map) => map.values().find_map(find_visitor),
        _ => None,
    }
}

/// The body one `/player` call needs.
fn player_body(client: &Client, video_id: &str, visitor: Option<&str>) -> Value {
    let mut inner = json!({
        "clientName": client.client_name,
        "clientVersion": client.client_version,
        "gl": "US",
        "hl": "en",
    });
    if let Some((os_name, os_version, make, model)) = client.device {
        inner["osName"] = json!(os_name);
        inner["osVersion"] = json!(os_version);
        inner["deviceMake"] = json!(make);
        inner["deviceModel"] = json!(model);
    }
    if let Some(sdk) = client.android_sdk {
        inner["androidSdkVersion"] = json!(sdk);
    }
    if let Some(visitor) = visitor {
        inner["visitorData"] = json!(visitor);
    }
    json!({
        "context": {
            "client": inner,
            "request": { "internalExperimentFlags": [], "useSsl": true },
            "user": { "lockedSafetyMode": false },
        },
        "videoId": video_id,
        "contentCheckOk": true,
        "racyCheckOk": true,
    })
}

/// The headers one `/player` call needs.
fn player_headers(client: &Client, visitor: Option<&str>) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        "x-goog-api-format-version",
        reqwest::header::HeaderValue::from_static("1"),
    );
    /* The NUMERIC client id, not the name. This is required. */
    headers.insert(
        "x-youtube-client-name",
        reqwest::header::HeaderValue::from_static(client.client_id),
    );
    headers.insert(
        "x-youtube-client-version",
        reqwest::header::HeaderValue::from_static(client.client_version),
    );
    headers.insert("x-origin", reqwest::header::HeaderValue::from_static(ORIGIN));
    headers.insert("referer", reqwest::header::HeaderValue::from_static(ORIGIN));
    headers.insert(
        reqwest::header::USER_AGENT,
        reqwest::header::HeaderValue::from_static(client.user_agent),
    );
    if let Some(visitor) = visitor {
        if let Ok(value) = reqwest::header::HeaderValue::from_str(visitor) {
            headers.insert("x-goog-visitor-id", value);
        }
    }
    headers
}

/// Is this format an audio one?
fn is_audio(format: &Value) -> bool {
    format
        .get("hasAudio")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || format
            .get("mimeType")
            .and_then(|v| v.as_str())
            .map(|m| m.starts_with("audio/"))
            .unwrap_or(false)
}

/// Is this the auto-dubbed version? Nobody wants that by accident.
fn is_dubbed(format: &Value) -> bool {
    format
        .get("audioTrackType")
        .and_then(|v| v.as_str())
        .map(|t| t.contains("DUBBED"))
        .unwrap_or(false)
}

/// How good this format is.
fn quality_rank(format: &Value) -> u32 {
    match format.get("audioQuality").and_then(|v| v.as_str()) {
        Some("AUDIO_QUALITY_HIGH") => 3,
        Some("AUDIO_QUALITY_MEDIUM") => 2,
        Some("AUDIO_QUALITY_LOW") => 1,
        _ => 0,
    }
}

/// A number, which YouTube sometimes sends as a string.
fn as_int(value: Option<&Value>) -> u64 {
    match value {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) as u64,
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

/// Pick the best audio format.
///
/// AAC in MP4 first: it is what the byte-range proxy declares as
/// `audio/mp4`, and what every decoder handles without argument. Opus is
/// ranked behind it rather than dropped, so a track that only publishes
/// Opus still plays.
fn pick_format(formats: &[Value]) -> Option<&Value> {
    let audio: Vec<&Value> = formats
        .iter()
        .filter(|f| is_audio(f) && f.get("url").and_then(|u| u.as_str()).is_some())
        .collect();
    if audio.is_empty() {
        return None;
    }
    let original: Vec<&Value> = audio.iter().copied().filter(|f| !is_dubbed(f)).collect();
    let pool = if original.is_empty() { audio } else { original };

    pool.into_iter().max_by_key(|format| {
        let mime = format
            .get("mimeType")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let aac = if mime.contains("mp4a") || mime.contains("audio/mp4") {
            1u32
        } else {
            0
        };
        (
            aac,
            quality_rank(format),
            as_int(format.get("bitrate")),
        )
    })
}

/// The container the format is in.
fn extension_of(format: &Value) -> String {
    let mime = format
        .get("mimeType")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if mime.contains("audio/webm") {
        "webm".into()
    } else {
        "m4a".into()
    }
}

/// Resolve a video to a playable address, fast.
///
/// Tries each client in turn. Returns `None` when none of them will do —
/// which is **not** an error: it means the caller should fall back to the
/// extractor, which is slower but handles more.
pub async fn resolve(
    http: &reqwest::Client,
    video_id: &str,
    visitor: Option<&str>,
) -> Option<Resolved> {

    for client in CLIENTS {
        let body = player_body(client, video_id, visitor);
        let headers = player_headers(client, visitor);

        let response = match http
            .post(PLAYER_URL)
            .headers(headers)
            .timeout(PLAYER_TIMEOUT)
            .json(&body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(data) = response.json::<Value>().await else {
            continue;
        };

        /* Is it playable at all? */
        let status = data
            .get("playabilityStatus")
            .and_then(|s| s.get("status"))
            .and_then(|s| s.as_str())
            .unwrap_or_default();
        if status != "OK" {
            continue;
        }

        let formats = data
            .get("streamingData")
            .and_then(|s| s.get("adaptiveFormats"))
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default();
        let Some(format) = pick_format(&formats) else {
            continue;
        };
        let Some(url) = format.get("url").and_then(|u| u.as_str()) else {
            continue;
        };

        /* Prove the address will serve bytes before handing it over.
         *
         * Not every client that answers OK hands out an address
         * googlevideo will honour — one of the Android VR builds answered
         * 200 with an address that then returned 403 to every request
         * shape. One HEAD turns that into a silent fallback instead of a
         * track that fails in the user's face. */
        if !validate(http, url, client.user_agent).await {
            continue;
        }

        let duration_secs = as_int(
            data.get("videoDetails")
                .and_then(|v| v.get("lengthSeconds")),
        );
        let duration_secs = if duration_secs > 0 {
            Some(duration_secs)
        } else {
            let ms = as_int(format.get("approxDurationMs"));
            if ms > 0 {
                Some(ms / 1000)
            } else {
                None
            }
        };

        return Some(Resolved {
            url: url.to_string(),
            client: client.key.to_string(),
            duration_secs,
            bitrate_kbps: Some((as_int(format.get("bitrate")) / 1000) as u32),
            extension: extension_of(format),
        });
    }
    None
}

/// Does this address serve bytes?
async fn validate(http: &reqwest::Client, url: &str, user_agent: &str) -> bool {
    let response = http
        .head(url)
        .header(reqwest::header::USER_AGENT, user_agent)
        .timeout(VALIDATE_TIMEOUT)
        .send()
        .await;
    match response {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// A visitor id, cached for a while.
pub struct VisitorCache(pub std::sync::Mutex<Option<Visitor>>);

impl VisitorCache {
    pub fn new() -> Self {
        VisitorCache(std::sync::Mutex::new(None))
    }

    /// The visitor id, fetching it if it is missing or old.
    pub async fn get(&self, http: &reqwest::Client) -> Option<String> {
        {
            let guard = self.0.lock().unwrap();
            if let Some(visitor) = guard.as_ref() {
                if visitor.at.elapsed() < VISITOR_TTL {
                    return Some(visitor.data.clone());
                }
            }
        }
        let fresh = visitor_data(http).await?;
        *self.0.lock().unwrap() = Some(Visitor {
            data: fresh.clone(),
            at: std::time::Instant::now(),
        });
        Some(fresh)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clients_are_the_ones_that_work() {
        /* VisionOS first: it wins almost every time. */
        assert_eq!(CLIENTS[0].key, "VISIONOS");
        assert_eq!(CLIENTS[0].client_id, "101");
        /* The Android VR builds differ by version on purpose. */
        assert_eq!(CLIENTS[1].key, "ANDROID_VR_1_43_32");
        assert_eq!(CLIENTS[2].key, "ANDROID_VR_1_65_10");
    }

    #[test]
    fn the_body_carries_the_client_identity() {
        let client = &CLIENTS[0];
        let body = player_body(client, "abc123", Some("CgVISITOR"));
        let inner = &body["context"]["client"];
        assert_eq!(inner["clientName"], "VISIONOS");
        assert_eq!(inner["clientVersion"], "0.1");
        assert_eq!(inner["visitorData"], "CgVISITOR");
        assert_eq!(inner["osName"], "visionOS");
        assert_eq!(inner["deviceMake"], "Apple");
        assert_eq!(body["videoId"], "abc123");
        assert_eq!(body["contentCheckOk"], true);
    }

    #[test]
    fn the_android_client_carries_its_sdk_version() {
        let client = &CLIENTS[1];
        let body = player_body(client, "abc", None);
        assert_eq!(body["context"]["client"]["androidSdkVersion"], "32");
        assert_eq!(body["context"]["client"]["deviceModel"], "Quest 3");
    }

    #[test]
    fn the_header_carries_the_numeric_client_id() {
        let client = &CLIENTS[0];
        let headers = player_headers(client, None);
        assert_eq!(
            headers.get("x-youtube-client-name").unwrap(),
            "101",
            "the numeric id, not the name"
        );
        assert_eq!(headers.get("x-origin").unwrap(), ORIGIN);
    }

    #[test]
    fn aac_in_mp4_wins_over_opus() {
        let formats = vec![
            json!({
                "mimeType": "audio/webm; codecs=\"opus\"",
                "bitrate": 128000,
                "audioQuality": "AUDIO_QUALITY_HIGH",
                "url": "https://example.invalid/opus",
                "hasAudio": true,
            }),
            json!({
                "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                "bitrate": 100000,
                "audioQuality": "AUDIO_QUALITY_MEDIUM",
                "url": "https://example.invalid/aac",
                "hasAudio": true,
            }),
        ];
        let picked = pick_format(&formats).unwrap();
        assert_eq!(picked.get("url").unwrap(), "https://example.invalid/aac");
    }

    #[test]
    fn a_dubbed_version_is_avoided() {
        let formats = vec![
            json!({
                "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                "bitrate": 256000,
                "audioQuality": "AUDIO_QUALITY_HIGH",
                "audioTrackType": "AUDIO_TRACK_TYPE_DUBBED",
                "url": "https://example.invalid/dubbed",
                "hasAudio": true,
            }),
            json!({
                "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                "bitrate": 100000,
                "audioQuality": "AUDIO_QUALITY_MEDIUM",
                "url": "https://example.invalid/original",
                "hasAudio": true,
            }),
        ];
        let picked = pick_format(&formats).unwrap();
        assert_eq!(picked.get("url").unwrap(), "https://example.invalid/original");
    }

    #[test]
    fn a_format_with_no_address_is_never_picked() {
        let formats = vec![json!({
            "mimeType": "audio/mp4",
            "hasAudio": true,
        })];
        assert!(pick_format(&formats).is_none());
    }

    #[test]
    fn the_visitor_id_is_found_by_its_shape() {
        /* The path into the blob is not documented, so it is found by
         * shape: a longish token starting with "Cg". */
        let text = concat!(
            ")]}'\n",
            r#"[[[null,null,[null,null,null,null,null,null,null,null,null,null,null,"CgTHEVISITORDATAthatislongenoughtolookreal"]]]]"#
        );
        assert_eq!(
            parse_visitor(text).as_deref(),
            Some("CgTHEVISITORDATAthatislongenoughtolookreal")
        );
    }

    #[test]
    fn a_blob_with_no_visitor_gives_none() {
        assert_eq!(parse_visitor("not json at all"), None);
    }
}
