//! The vocabulary of a source.
//!
//! A *source* is an adapter that can turn a content id into playable bytes.
//! The registry (see [`crate::registry`]) knows about several of them and
//! picks one; this module defines what one looks like.
//!
//! The rules that matter, and why they exist:
//!
//! - **A source never returns a URL.** It returns a [`StreamHandle`], which
//!   is a live pipe to the bytes. The whole point is that a URL is a
//!   liability: it expires, it leaks, and it invites the player to cache it.
//! - **A handle is only handed out after a byte has arrived.** A source that
//!   can describe something but not deliver it is not a source.
//! - **Refusals are not failures.** A provider that says "no" is telling the
//!   truth about itself, and the registry needs to tell that apart from a
//!   network wobble. [`SourceError::Refused`] is that distinction.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

/// What a piece of content is, in a way every source can speak.
///
/// A content id is a provider plus whatever that provider calls the thing.
/// The registry passes it around; it never interprets it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct ContentId {
    /// The provider's own name, e.g. `jamendo`.
    pub provider: String,
    /// The provider's identifier for the item.
    pub external_id: String,
}

impl ContentId {
    pub fn new(provider: &str, external_id: impl Into<String>) -> Self {
        Self {
            provider: provider.to_string(),
            external_id: external_id.into(),
        }
    }
}

impl fmt::Display for ContentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.provider, self.external_id)
    }
}

/// What a piece of content is called, and who made it.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Metadata {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    /// Seconds, if the provider says.
    #[serde(default)]
    pub duration_secs: Option<u64>,
    /// A URL for cover art. Unlike a *playback* URL this is fine to hand
    /// around: it is public, it does not expire, and it is not a secret.
    #[serde(default)]
    pub artwork_url: Option<String>,
    /// The licence, when the provider states one. Shown to the user, because
    /// for the open-licensed sources it is the whole point.
    #[serde(default)]
    pub license: Option<String>,
}

/// Why a source could not deliver.
#[derive(Debug, Clone, thiserror::Error)]
pub enum SourceError {
    /// The provider refused: 401, 403, 429, an explicit denial.
    ///
    /// This is not a wobble. Retrying immediately will not help, and a source
    /// that keeps refusing should be stood down for a while.
    #[error("refused by the provider: {0}")]
    Refused(String),

    /// The content is protected by DRM, or otherwise cannot be delivered in
    /// raw form. Treated like a refusal, because it is one in practice.
    #[error("protected content: {0}")]
    Protected(String),

    /// A network problem, a timeout, a 5xx. Worth trying again later.
    #[error("transient failure: {0}")]
    Transient(String),

    /// The source does not have this content.
    #[error("not available from this source: {0}")]
    NotFound(String),

    /// The source is not configured — no API key, no tool on disk, the opt-in
    /// flag is off.
    #[error("not configured: {0}")]
    NotConfigured(String),

    /// The user cancelled.
    #[error("cancelled")]
    Cancelled,
}

impl SourceError {
    /// Whether this is the kind of failure that should count against the
    /// source's strike count.
    ///
    /// Only refusals and protected content do. A timeout is the network's
    /// fault, and punishing the source for it would take a good source out
    /// of rotation because of a bad minute.
    pub fn is_refusal(&self) -> bool {
        matches!(self, Self::Refused(_) | Self::Protected(_))
    }
}

/// How a source is doing.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    /// Never checked.
    #[default]
    Unknown,
    /// Checked recently and working.
    Healthy,
    /// Checked recently and not working. The reason says why.
    Unhealthy(String),
    /// Working, but with a complaint — rate limited, slow, whatever.
    Degraded(String),
}

impl Health {
    pub fn is_usable(&self) -> bool {
        matches!(self, Self::Healthy | Self::Degraded(_) | Self::Unknown)
    }
}

/// The result of asking a source how it is.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResult {
    pub health: Health,
    /// How long the check took.
    pub latency_ms: u64,
    /// When the check happened, in milliseconds since the epoch.
    pub checked_at: u64,
}

/// A stream that has been opened and proved to have bytes in it.
pub struct OpenedStream {
    /// The bytes, in order, starting at the first byte of the content.
    pub reader: Box<dyn tokio::io::AsyncRead + Send + Unpin>,
    /// **How many bytes this stream actually carries.**
    ///
    /// For a ranged request that is the length of the range, not the
    /// length of the whole thing. The server promises exactly this many
    /// bytes to the player, so a source that says otherwise gets its
    /// connection thrown away — the player sees a body that does not
    /// match the length it was promised.
    pub content_length: Option<u64>,
    /// The content type, if the provider said.
    pub content_type: Option<String>,
}

/// Opens the content again, optionally at a byte offset.
///
/// The player seeks by making a **new** request with a `Range` header, so a
/// stream that cannot be re-opened cannot be seeked in. Every source here
/// can open itself again, and the server uses that to answer a range
/// request properly instead of pretending.
///
/// The function is the *only* place the real address of the content lives.
/// It is not returned to the player, not logged, and not written to disk.
pub type StreamOpener = std::sync::Arc<
    dyn Fn(Option<(u64, Option<u64>)>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<OpenedStream, SourceError>> + Send>>
        + Send
        + Sync,
>;

/// Box a future so it can come out of an opener closure.
///
/// The cast is needed because the closure's return type is fixed, and an
/// `async` block has its own anonymous type. Doing it in one place keeps
/// that noise out of every adapter.
pub fn boxed_stream(
    future: impl std::future::Future<Output = Result<OpenedStream, SourceError>> + Send + 'static,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<OpenedStream, SourceError>> + Send>>
{
    Box::pin(future)
}

/// A handle to playable content.
///
/// This is deliberately *not* a URL. It is the thing you open. The address
/// the source used is inside the closure and never comes back out.
pub struct StreamHandle {
    /// Opens the bytes. Call it with `None` for the whole thing, or with a
    /// byte range to start partway through.
    pub opener: StreamOpener,
    /// How long the content is, if the provider said.
    pub content_length: Option<u64>,
    /// The content type, if the provider said.
    pub content_type: Option<String>,
    /// Which source actually produced this. Recorded so the registry can
    /// remember it worked.
    pub source_id: String,
    /// The provider's own identifier for the item, so a handle can be
    /// matched back to a search result.
    pub content_id: ContentId,
}

impl StreamHandle {
    /// Open the content, optionally at a byte range.
    pub async fn open(
        &self,
        range: Option<(u64, Option<u64>)>,
    ) -> Result<OpenedStream, SourceError> {
        (self.opener)(range).await
    }
}

impl fmt::Debug for StreamHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StreamHandle")
            .field("source_id", &self.source_id)
            .field("content_id", &self.content_id)
            .field("content_length", &self.content_length)
            .field("content_type", &self.content_type)
            .finish_non_exhaustive()
    }
}

/// A source of playable content.
///
/// The registry only ever needs these four things.
#[async_trait::async_trait]
pub trait Source: Send + Sync {
    /// A stable name. Used in the persisted state, so it must not change
    /// between runs.
    fn id(&self) -> &str;

    /// A human name, for the settings screen.
    fn display_name(&self) -> &str {
        self.id()
    }

    /// Whether this source is configured well enough to be tried at all.
    ///
    /// A source that has no API key, or whose opt-in flag is off, says so
    /// here and is never asked to do work.
    fn is_configured(&self) -> bool {
        true
    }

    /// Why it is not configured, for the settings screen.
    fn not_configured_reason(&self) -> Option<String> {
        None
    }

    /// Whether this source could plausibly have this content.
    ///
    /// Cheap, and allowed to be wrong in the "yes" direction: it is a filter,
    /// not a promise. The registry treats a `false` as "skip this one".
    fn supports(&self, content: &ContentId) -> bool {
        content.provider == self.id()
    }

    /// Search this source for something.
    ///
    /// A source that cannot search says so with
    /// [`SourceError::NotConfigured`]. The results are metadata and content
    /// ids — no addresses, because the addresses do not exist until the
    /// content is opened.
    async fn search(
        &self,
        _query: &str,
        _limit: u32,
    ) -> Result<Vec<(Metadata, ContentId)>, SourceError> {
        Err(SourceError::NotConfigured("this source does not search".into()))
    }

    /// Ask the source how it is doing, without asking for real content.
    async fn health_check(&self) -> HealthResult;

    /// Open a stream to the content.
    ///
    /// The implementation must not return until it has read at least one byte
    /// from the remote end, or failed. A handle whose first read yields
    /// nothing is a handle that lies.
    ///
    /// The returned handle must be able to open the content **again** — the
    /// player seeks by making a new request, and the server answers it by
    /// asking the source for the bytes it wants.
    async fn open_stream(
        &self,
        content: &ContentId,
        cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError>;
}

/// A cancellation flag that is cheap to clone and safe to share.
///
/// This is a small stand-in for `tokio_util::sync::CancellationToken` so
/// that the source trait does not force a dependency on `tokio-util` for
/// every implementor. It is the same shape: a flag plus a set of waiters.
#[derive(Clone)]
pub struct CancellationToken {
    inner: Arc<CancellationInner>,
}

struct CancellationInner {
    /// `true` means cancelled. A watch channel is used rather than an
    /// atomic flag so that a waiter can be woken immediately, instead of
    /// polling on a timer.
    tx: tokio::sync::watch::Sender<bool>,
}

impl Default for CancellationToken {
    fn default() -> Self {
        let (tx, _) = tokio::sync::watch::channel(false);
        Self {
            inner: Arc::new(CancellationInner { tx }),
        }
    }
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        /* `send_replace` and not `send`: a `send` fails when there are no
         * receivers yet, and — worse — it does not store the value when it
         * fails. Cancelling before anything is listening has to work. */
        self.inner.tx.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.inner.tx.borrow()
    }

    /// A future that resolves when this is cancelled.
    pub fn cancelled(&self) -> impl std::future::Future<Output = ()> + Send + 'static {
        let mut rx = self.inner.tx.subscribe();
        async move {
            // The sender is kept alive by the token, so this never errors
            // with a closed channel while the token lives.
            while !*rx.borrow_and_update() {
                if rx.changed().await.is_err() {
                    return;
                }
            }
        }
    }
}

/// How long a health check may take.
pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(8);
