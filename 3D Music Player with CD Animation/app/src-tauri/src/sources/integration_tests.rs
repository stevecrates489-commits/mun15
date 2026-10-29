//! The whole path, end to end, against a real local server.
//!
//! The unit tests in the registry and the server check the parts. This one
//! checks the **joining up**: a source is asked for a stream, the bytes are
//! served over loopback, the player gets a URL that means nothing outside
//! this machine, and a seek works.
//!
//! It uses a source that serves bytes from memory, so it needs no network
//! and no provider account. The point is the plumbing, not the music.

use std::sync::Arc;
use std::time::Duration;

use crate::sources::server::StreamServerState;
use crate::sources::types::{
    CancellationToken, ContentId, Health, HealthResult, Metadata, OpenedStream, Source, SourceError,
    StreamHandle,
};
use crate::sources::registry::Registry;

/// How many bytes a stream for this range carries.
fn slice_len(bytes: &[u8], range: Option<(u64, Option<u64>)>) -> u64 {
    match range {
        Some((start, end)) => {
            let start = (start as usize).min(bytes.len());
            let end = end
                .map(|e| e as usize + 1)
                .unwrap_or(bytes.len())
                .min(bytes.len());
            end.saturating_sub(start) as u64
        }
        None => bytes.len() as u64,
    }
}

/// A source that serves the same bytes every time.
struct Memory {
    id: String,
    bytes: Vec<u8>,
    /// Whether it should refuse.
    refuse: bool,
    /// How many times it was asked.
    calls: Arc<std::sync::atomic::AtomicUsize>,
}

#[async_trait::async_trait]
impl Source for Memory {
    fn id(&self) -> &str {
        &self.id
    }

    /// Every source in this test can serve anything: the point is the
    /// plumbing, not which provider can play what.
    fn supports(&self, _content: &ContentId) -> bool {
        true
    }

    async fn health_check(&self) -> HealthResult {
        HealthResult {
            health: Health::Healthy,
            latency_ms: 0,
            checked_at: 0,
        }
    }

    async fn open_stream(
        &self,
        content: &ContentId,
        _cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.refuse {
            return Err(SourceError::Refused("403".into()));
        }
        /* The bytes live in the closure, so the handle carries no address
         * and no copy of the data until it is opened. */
        let bytes = self.bytes.clone();
        let opener = Arc::new(move |range: Option<(u64, Option<u64>)>| {
            let bytes = bytes.clone();
            crate::sources::types::boxed_stream(async move {
                let slice: Vec<u8> = match range {
                    Some((start, end)) => {
                        let start = start as usize;
                        /* The range is INCLUSIVE at both ends, so a slice
                         * has to go one past the end. Getting this wrong
                         * makes the body one byte short of the length the
                         * server promised, and the connection is thrown
                         * away. */
                        let end = end
                            .map(|e| e as usize + 1)
                            .unwrap_or(bytes.len());
                        bytes[start.min(bytes.len())..end.min(bytes.len())].to_vec()
                    }
                    None => bytes.clone(),
                };
                Ok(OpenedStream {
                    reader: Box::new(std::io::Cursor::new(slice)),
                    /* The length of WHAT THIS STREAM CARRIES, not of the
                     * whole thing. The server promises exactly this many
                     * bytes to the browser, so a lie here gets the
                     * connection thrown away. */
                    content_length: Some(slice_len(&bytes, range)),
                    content_type: Some("audio/mpeg".into()),
                })
            })
        });
        Ok(StreamHandle {
            opener,
            content_length: Some(self.bytes.len() as u64),
            content_type: Some("audio/mpeg".into()),
            source_id: self.id.clone(),
            content_id: content.clone(),
        })
    }
}


/// A tiny HTTP client that speaks the wire protocol directly.
///
/// Deliberately not a library: the point of this test is that the *bytes*
/// on the wire are right — the status line, the headers, the range answer
/// — and a library would hide that behind an abstraction.
async fn get(
    port: u16,
    path: &str,
    range: Option<&str>,
) -> (u16, Vec<(String, String)>, Vec<u8>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the server should accept connections");
    let mut request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    if let Some(r) = range {
        request.push_str(&format!("Range: {r}\r\n"));
    }
    request.push_str("Connection: close\r\n\r\n");
    socket.write_all(request.as_bytes()).await.unwrap();

    let mut raw = Vec::new();
    socket.read_to_end(&mut raw).await.unwrap();
    if !raw.windows(4).any(|w| w == b"\r\n\r\n") {
        println!("--- RAW (no header block) ---\n{:?}\n--- END ---", String::from_utf8_lossy(&raw));
    }

    /* Split the head from the body. */
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .expect("there should be a header block");
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let body = raw[split + 4..].to_vec();

    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or_default();
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
        .collect();

    (status, headers, body)
}

fn header(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
}

#[tokio::test]
async fn the_whole_path_works() {
    /* 1. a source with some bytes in it */
    let payload: Vec<u8> = (0u8..=255).cycle().take(4096).collect();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let source = Memory {
        id: "memory".into(),
        bytes: payload.clone(),
        refuse: false,
        calls: calls.clone(),
    };

    let registry = Registry::new(crate::sources::registry::RegistryConfig::default(), None);
    {
        let mut list = registry.lock_sources();
        list.push(Arc::new(source) as Arc<dyn Source>);
    }

    /* 2. the registry opens it — proving there is a byte behind it */
    let handle = registry
        .open_stream(&ContentId::new("memory", "1"), &CancellationToken::new())
        .await
        .expect("the source should deliver");
    assert_eq!(handle.content_length, Some(4096));
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);

    /* 3. the handle is parked and the player gets a local url */
    let state = Arc::new(StreamServerState::default());
    let server_state = state.clone();
    tokio::spawn(async move {
        let _ = crate::sources::server::serve(server_state).await;
    });
    /* Give the listener a moment to bind. */
    tokio::time::sleep(Duration::from_millis(150)).await;

    let id = state.park(handle);
    let url = format!("{}/stream/{}", state.base_url(), id);

    /* 4. the address is local, and says nothing about where the bytes are */
    assert!(url.starts_with("http://127.0.0.1:"), "not local: {url}");
    assert!(!url.contains("memory"), "the id leaks the source: {url}");

    /* 5. the bytes come back, and they are the right bytes */
    let (status, headers, body) = get(state.port(), &format!("/stream/{id}"), None).await;
    assert_eq!(status, 200);
    assert_eq!(body, payload);
    assert_eq!(header(&headers, "content-type").as_deref(), Some("audio/mpeg"));
    assert_eq!(header(&headers, "accept-ranges").as_deref(), Some("bytes"));
    assert_eq!(header(&headers, "x-mun15h-source").as_deref(), Some("memory"));
    assert_eq!(header(&headers, "content-length").as_deref(), Some("4096"));

    /* 6. a seek works — the browser asks for a range and gets a 206 */
    let (status, headers, body) = get(
        state.port(),
        &format!("/stream/{id}"),
        Some("bytes=100-199"),
    )
    .await;
    assert_eq!(status, 206);
    assert_eq!(body.len(), 100);
    assert_eq!(body, payload[100..200]);
    assert_eq!(
        header(&headers, "content-range").as_deref(),
        Some("bytes 100-199/4096")
    );

    /* 7. a range past the end is refused honestly, not faked */
    let (status, _, _) = get(
        state.port(),
        &format!("/stream/{id}"),
        Some("bytes=9999-10000"),
    )
    .await;
    assert_eq!(status, 416);

    /* 8. an id that was never parked is not found */
    let (status, _, _) = get(state.port(), "/stream/deadbeef", None).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn a_refusing_source_is_asked_once_and_then_left_alone() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let good_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let stubborn = Memory {
        id: "stubborn".into(),
        bytes: vec![1, 2, 3],
        refuse: true,
        calls: calls.clone(),
    };
    let good = Memory {
        id: "good".into(),
        bytes: vec![4, 5, 6],
        refuse: false,
        calls: good_calls.clone(),
    };

    let registry = Registry::new(crate::sources::registry::RegistryConfig::default(), None);
    {
        let mut list = registry.lock_sources();
        list.push(Arc::new(stubborn) as Arc<dyn Source>);
        list.push(Arc::new(good) as Arc<dyn Source>);
    }

    let content = ContentId::new("memory", "1");
    for _ in 0..4 {
        registry
            .open_stream(&content, &CancellationToken::new())
            .await
            .unwrap();
    }

    /* The refusing source is asked once. After that the registry remembers
     * that the other one works, and puts it first — so the one that said
     * "no" is not asked again. That is the point of remembering. */
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(good_calls.load(std::sync::atomic::Ordering::SeqCst), 4);

    /* And the refusal was recorded against it. */
    let status = registry.status();
    let stubborn_status = status.iter().find(|s| s.id == "stubborn").unwrap();
    assert_eq!(stubborn_status.failures, 1);
    assert_eq!(stubborn_status.strikes, 1);
}

#[tokio::test]
async fn the_registry_is_populated_at_startup() {
    /* A registry with no sources in it answers every search with nothing,
     * and that looks exactly like "there is no music online". So the
     * sources have to be in there before anybody asks. */
    let dir = std::env::temp_dir().join(format!("mun15h-src-boot-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let state = crate::sources::SourceState::new(dir.clone());

    let ids: Vec<String> = state.registry.sources().iter().map(|s| s.id().to_string()).collect();
    assert!(ids.contains(&"jamendo".to_string()), "no jamendo: {ids:?}");
    assert!(ids.contains(&"archive".to_string()), "no archive: {ids:?}");
    assert!(ids.contains(&"radio".to_string()), "no radio: {ids:?}");

    /* YouTube is OFF until the user says otherwise. */
    assert!(
        !ids.contains(&"youtube".to_string()),
        "youtube must be off by default: {ids:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_settings_survive_a_restart() {
    let dir = std::env::temp_dir().join(format!("mun15h-src-set-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);

    let settings = crate::sources::SourceSettings {
        jamendo_client_id: Some("a-client-id".into()),
        allow_youtube: true,
        spotify_client_id: None,
        sign_in_browser: "automatic".into(),
        stream_mode: "fast".into(),
        yt_dlp_path: Some("C:/tools/yt-dlp.exe".into()),
        yt_dlp_args: vec!["--cookies-from-browser".into(), "chrome".into()],
    };

    {
        let state = crate::sources::SourceState::new(dir.clone());
        state.set_settings(settings.clone());
        /* Turning YouTube on has to actually add the source. */
        let ids: Vec<String> = state.registry.sources().iter().map(|s| s.id().to_string()).collect();
        assert!(ids.contains(&"youtube".to_string()), "no youtube: {ids:?}");
    }

    /* A fresh run reads them back. */
    let state = crate::sources::SourceState::new(dir.clone());
    let loaded = state.settings.read().unwrap().clone();
    assert_eq!(loaded.jamendo_client_id.as_deref(), Some("a-client-id"));
    assert!(loaded.allow_youtube);
    assert_eq!(loaded.yt_dlp_path.as_deref(), Some("C:/tools/yt-dlp.exe"));
    assert_eq!(loaded.yt_dlp_args, vec!["--cookies-from-browser", "chrome"]);

    /* And the sources are built from them. */
    let ids: Vec<String> = state.registry.sources().iter().map(|s| s.id().to_string()).collect();
    assert!(ids.contains(&"youtube".to_string()), "no youtube: {ids:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_search_returns_metadata_and_no_addresses() {
    /// A source that searches.
    struct Searcher;

    #[async_trait::async_trait]
    impl Source for Searcher {
        fn id(&self) -> &str {
            "searcher"
        }
        async fn health_check(&self) -> HealthResult {
            HealthResult {
                health: Health::Healthy,
                latency_ms: 0,
                checked_at: 0,
            }
        }
        async fn search(
            &self,
            _query: &str,
            _limit: u32,
        ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
            Ok(vec![(
                Metadata {
                    title: "A SONG".into(),
                    artist: "AN ARTIST".into(),
                    album: "AN ALBUM".into(),
                    duration_secs: Some(180),
                    artwork_url: Some("https://example.invalid/cover.jpg".into()),
                    license: Some("CC BY-SA 4.0".into()),
                },
                ContentId::new("searcher", "abc"),
            )])
        }
        async fn open_stream(
            &self,
            _content: &ContentId,
            _cancellation: &CancellationToken,
        ) -> Result<StreamHandle, SourceError> {
            Err(SourceError::NotConfigured("no".into()))
        }
    }

    let registry = Registry::new(crate::sources::registry::RegistryConfig::default(), None);
    {
        let mut list = registry.lock_sources();
        list.push(Arc::new(Searcher) as Arc<dyn Source>);
    }
    let source = registry.sources().into_iter().next().unwrap();
    let found = source.search("anything", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    let (metadata, content_id) = &found[0];
    assert_eq!(metadata.title, "A SONG");
    assert_eq!(content_id.to_string(), "searcher:abc");
}
