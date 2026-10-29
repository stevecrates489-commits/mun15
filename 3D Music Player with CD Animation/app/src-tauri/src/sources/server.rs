//! The local stream server.
//!
//! The player needs *something* to point an `<audio>` element at. The only
//! thing it may be pointed at is a URL — but not a remote one. So the bytes
//! are served here, on the loopback interface, and the player gets a URL
//! that means nothing outside this machine.
//!
//! How the no-URL rule is kept:
//!
//! 1. A source opens a stream and produces a [`StreamHandle`] — a way to
//!    open the bytes again, with the real address sealed inside.
//! 2. The handle is parked under an opaque id.
//! 3. The player is told `http://127.0.0.1:<port>/stream/<id>`.
//! 4. The id is meaningless to anyone else. It maps to a closure, not to a
//!    remote address, and it is not derivable from one.
//!
//! The remote address — if there even is one, behind a redirect or a token —
//! stays inside the closure and never comes back out. It is not in the id,
//! not in a header, and not in the response.
//!
//! ## Range requests
//!
//! Seeking needs `Range`. The browser asks for a byte range with a *new*
//! request, so the stream has to be openable again. That is why a
//! [`StreamHandle`] is a closure rather than a one-shot reader: the server
//! calls it again with the range the browser asked for, and the source
//! fetches exactly those bytes.

use std::collections::HashMap;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;

use super::types::StreamHandle;

/// A parked stream, waiting to be read.
struct Parked {
    handle: StreamHandle,
    /// When this was parked. Old handles are swept.
    parked_at: std::time::Instant,
}

/// The server's state.
pub struct StreamServerState {
    /// The parked streams.
    ///
    /// A plain mutex rather than a tokio one, because parking happens on a
    /// synchronous path (the command layer) and the critical section is a
    /// map insert — there is nothing to await inside it.
    streams: std::sync::Mutex<HashMap<String, Parked>>,
    /// The port that was actually bound. Zero until the server starts.
    port: std::sync::atomic::AtomicU16,
    /// A counter for making ids that nobody can guess.
    counter: std::sync::atomic::AtomicU64,
    /// The secret the ids are derived from. Random per run, so an id from
    /// one run is meaningless in the next.
    secret: [u8; 16],
}

impl Default for StreamServerState {
    fn default() -> Self {
        let mut secret = [0u8; 16];
        // A failure here would mean the system has no entropy at all, which
        // is not a situation worth defending against differently.
        let _ = getrandom::fill(&mut secret);
        Self {
            streams: std::sync::Mutex::new(HashMap::new()),
            port: std::sync::atomic::AtomicU16::new(0),
            counter: std::sync::atomic::AtomicU64::new(0),
            secret,
        }
    }
}

impl StreamServerState {
    /// The base URL the player should use.
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port())
    }

    pub fn port(&self) -> u16 {
        self.port.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Park a stream and return the id it can be fetched by.
    pub fn park(&self, handle: StreamHandle) -> String {
        use std::hash::{Hash, Hasher};
        let n = self.counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        /* The id is a hash of the secret, the counter and the time. It is
         * not reversible into anything, and it changes every run. */
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        self.secret.hash(&mut hasher);
        n.hash(&mut hasher);
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
            .hash(&mut hasher);
        let id = format!("{:016x}", hasher.finish());

        let mut streams = self.streams.lock().unwrap();
        /* Keep the table small: a handle nobody plays is a handle holding a
         * connection open. */
        if streams.len() > 64 {
            let mut entries: Vec<(String, std::time::Instant)> = streams
                .iter()
                .map(|(k, v)| (k.clone(), v.parked_at))
                .collect();
            entries.sort_by_key(|(_, t)| *t);
            for (id, _) in entries.into_iter().take(32) {
                streams.remove(&id);
            }
        }
        streams.insert(
            id.clone(),
            Parked {
                handle,
                parked_at: std::time::Instant::now(),
            },
        );
        id
    }

    /// Look a stream up without taking it away.
    ///
    /// It stays in the table because the browser will come back for a range
    /// request when the user seeks.
    async fn get(&self, id: &str) -> Option<StreamHandle> {
        let mut streams = self.streams.lock().unwrap();
        let parked = streams.get_mut(id)?;
        parked.parked_at = std::time::Instant::now();
        Some(parked.handle.clone_handle())
    }
}

/// Cloning a handle: the handle is a bag of plain data plus a closure, so
/// it can be cloned without the bytes being duplicated.
trait CloneHandle {
    fn clone_handle(&self) -> StreamHandle;
}

impl CloneHandle for StreamHandle {
    fn clone_handle(&self) -> StreamHandle {
        StreamHandle {
            opener: self.opener.clone(),
            content_length: self.content_length,
            content_type: self.content_type.clone(),
            source_id: self.source_id.clone(),
            content_id: self.content_id.clone(),
        }
    }
}

/// The player asked for a stream.
async fn stream_handler(
    State(state): State<Arc<StreamServerState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(handle) = state.get(&id).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    /* What the browser is asking for, if anything. */
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|r| parse_range(r, handle.content_length));

    /* If the browser asked for something we cannot give, say so honestly
     * rather than quietly sending the whole thing. */
    if headers.get(header::RANGE).is_some() && range.is_none() {
        let mut response = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
        if let Some(total) = handle.content_length {
            if let Ok(value) = HeaderValue::from_str(&format!("bytes */{total}")) {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
        }
        return response;
    }

    /* Open the content, at the right place. */
    let opened = match handle.open(range).await {
        Ok(opened) => opened,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };

    let content_type = opened
        .content_type
        .clone()
        .or_else(|| handle.content_type.clone())
        .unwrap_or_else(|| "audio/mpeg".to_string());

    /* Two different lengths, and they are not interchangeable:
     *
     * - `total` is how long the WHOLE thing is. It goes in the
     *   `Content-Range` header, and it is what the browser uses to work
     *   out where it is in the track.
     * - `sent` is how many bytes this response actually carries. For a
     *   ranged request that is the range's length, not the whole length.
     *
     * Using the range's length as the total is how a seek ends up with a
     * `Content-Length` that does not match the body — and a browser that
     * gets a short body throws the connection away. */
    let total = handle.content_length;
    let sent = opened.content_length;

    let mut response = Response::new(Body::empty());
    let hdr = response.headers_mut();
    hdr.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    /* The player is a different origin from the loopback server, so the
     * answer has to say it is allowed to be read. */
    hdr.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    hdr.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Accept-Ranges, Content-Length"),
    );
    hdr.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    /* Which source served it. A name, never an address. */
    if let Ok(value) = HeaderValue::from_str(&handle.source_id) {
        hdr.insert("x-mun15h-source", value);
    }

    match range {
        Some((start, end)) => {
            /* The length of this response: what the source says it sent,
             * or what the range asked for. */
            let length = sent.or_else(|| match (total, end) {
                (Some(total), Some(end)) => Some((end - start + 1).min(total.saturating_sub(start))),
                _ => None,
            });
            if let Some(len) = length {
                if let Ok(value) = HeaderValue::from_str(&len.to_string()) {
                    hdr.insert(header::CONTENT_LENGTH, value);
                }
            }
            let range_value = match (total, end) {
                (Some(total), Some(end)) => format!("bytes {}-{}/{}", start, end, total),
                _ => format!("bytes {}-", start),
            };
            if let Ok(value) = HeaderValue::from_str(&range_value) {
                hdr.insert(header::CONTENT_RANGE, value);
            }
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        }
        None => {
            if let Some(len) = sent.or(total) {
                if let Ok(value) = HeaderValue::from_str(&len.to_string()) {
                    hdr.insert(header::CONTENT_LENGTH, value);
                }
            }
        }
    }

    *response.body_mut() = Body::from_stream(stream_bytes(opened.reader));
    response
}

/// Turn a reader into a stream of bytes the server can send.
fn stream_bytes(
    reader: Box<dyn tokio::io::AsyncRead + Send + Unpin>,
) -> impl futures_util::Stream<Item = Result<axum::body::Bytes, std::io::Error>> + Send {
    tokio_util::io::ReaderStream::new(reader)
}

/// Parse `bytes=start-end` into a byte range.
fn parse_range(header: &str, total: Option<u64>) -> Option<(u64, Option<u64>)> {
    let spec = header.strip_prefix("bytes=")?;
    let (start_text, end_text) = spec.split_once('-')?;
    let start_text = start_text.trim();
    let end_text = end_text.trim();

    /* A suffix range ("bytes=-500") means the last 500 bytes. */
    if start_text.is_empty() {
        let want: u64 = end_text.parse().ok()?;
        let total = total?;
        if want == 0 {
            return None;
        }
        return Some((total.saturating_sub(want), Some(total.saturating_sub(1))));
    }

    let start: u64 = start_text.parse().ok()?;
    let end: Option<u64> = match end_text {
        "" => None,
        text => text.parse().ok(),
    };
    let end = match end {
        Some(e) => Some(e),
        None => total.map(|t| t.saturating_sub(1)),
    };
    if let Some(total) = total {
        if start >= total {
            return None;
        }
    }
    Some((start, end))
}

/// Run the server until the process ends.
pub async fn serve(state: Arc<StreamServerState>) -> std::io::Result<()> {
    let app = Router::new()
        /* axum 0.8 spells a path parameter `{id}`, not `:id` — the old
         * spelling panics when the router is built. */
        .route("/stream/{id}", get(stream_handler))
        .route("/health", get(health_handler))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    state.port.store(port, std::sync::atomic::Ordering::SeqCst);

    axum::serve(listener, app).await
}

async fn health_handler() -> &'static str {
    "ok"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::types::{ContentId, OpenedStream, SourceError};

    #[test]
    fn parses_a_plain_range() {
        assert_eq!(parse_range("bytes=0-99", Some(1000)), Some((0, Some(99))));
        assert_eq!(parse_range("bytes=100-", Some(1000)), Some((100, Some(999))));
    }

    #[test]
    fn parses_a_suffix_range() {
        assert_eq!(parse_range("bytes=-500", Some(1000)), Some((500, Some(999))));
    }

    #[test]
    fn rejects_nonsense() {
        assert_eq!(parse_range("not-a-range", Some(1000)), None);
        assert_eq!(parse_range("bytes=abc-1", Some(1000)), None);
        /* a range past the end is not satisfiable */
        assert_eq!(parse_range("bytes=5000-6000", Some(1000)), None);
    }

    #[tokio::test]
    async fn parked_ids_do_not_reveal_the_source() {
        let state = StreamServerState::default();
        let handle = StreamHandle {
            opener: Arc::new(|_| {
                Box::pin(async {
                    Ok(OpenedStream {
                        reader: Box::new(tokio::io::empty()),
                        content_length: None,
                        content_type: None,
                    })
                })
            }),
            content_length: Some(1234),
            content_type: Some("audio/mpeg".into()),
            source_id: "jamendo".into(),
            content_id: ContentId::new("jamendo", "1"),
        };
        let id = state.park(handle);
        assert!(!id.contains("jamendo"));
        assert!(!id.contains("http"));
        assert!(!id.contains("127.0.0.1"));
    }

    #[tokio::test]
    async fn parking_twice_gives_different_ids() {
        let state = StreamServerState::default();
        let make = || StreamHandle {
            opener: Arc::new(|_| {
                Box::pin(async {
                    Err(SourceError::Transient("unused".into()))
                })
            }),
            content_length: None,
            content_type: None,
            source_id: "x".into(),
            content_id: ContentId::new("x", "1"),
        };
        let a = state.park(make());
        let b = state.park(make());
        assert_ne!(a, b);
    }
}
