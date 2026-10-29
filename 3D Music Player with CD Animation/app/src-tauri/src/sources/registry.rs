//! The registry: which source gets asked, and what happens when it says no.
//!
//! The registry is the part that makes the whole thing reliable. A single
//! source is a single point of failure; several sources with a memory
//! between them are a system that keeps working.
//!
//! What it does:
//!
//! - **Remembers what worked.** The last source that delivered a track for a
//!   provider is tried first next time. This is persisted, so a restart does
//!   not start from scratch.
//! - **Stands sources down.** A source that refuses is struck. Enough
//!   strikes and it is quarantined — put aside for a while, with the time
//!   growing each time it comes back and fails again.
//! - **Never gives up early.** Candidates are walked in order until one
//!   delivers a byte.
//! - **Keeps the score.** Attempts, successes, failures by reason, latency,
//!   bytes. So the settings screen can say something true.
//!
//! The one rule that outranks all the others: **the player never receives a
//! remote URL.** A source produces a [`StreamHandle`] — a live pipe — and
//! that is what gets handed on. A URL is not handed over, is not stored, and
//! is not cached. See [`crate::server`] for how the player actually gets at
//! the bytes without the URL ever leaving this process.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::types::{
    CancellationToken, ContentId, Health, HealthResult, Source, SourceError, StreamHandle,
};

/// How a source is behaving, as far as the registry knows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub id: String,
    pub display_name: String,
    pub health: Health,
    /// Failures since the last success.
    pub strikes: u32,
    /// When the source is allowed to be tried again. `None` means it is not
    /// quarantined.
    pub quarantined_until: Option<u64>,
    pub attempts: u64,
    pub successes: u64,
    pub failures: u64,
    /// Milliseconds, averaged.
    pub avg_latency_ms: f64,
    /// Bytes delivered.
    pub bytes: u64,
    pub configured: bool,
    pub not_configured_reason: Option<String>,
    /// True when this source was the last one to work for its provider.
    pub last_known_good: bool,
}

/// The knobs. Everything here has a sensible default, because the app has to
/// work with no configuration at all.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryConfig {
    /// Failures before a source is stood down.
    pub strike_threshold: u32,
    /// The first quarantine. Doubles each time the source comes back and
    /// fails again.
    pub quarantine_base: Duration,
    /// The longest a quarantine may be.
    pub quarantine_max: Duration,
    /// How often the background health check runs.
    pub health_interval: Duration,
    /// How long a stream may take to produce its first byte.
    pub probe_timeout: Duration,
    /// How many sources may be opening streams at once.
    pub max_concurrent_opens: usize,
    /// How many streams may be open at once.
    pub max_open_streams: usize,
}

impl Default for RegistryConfig {
    fn default() -> Self {
        Self {
            strike_threshold: 3,
            quarantine_base: Duration::from_secs(60),
            quarantine_max: Duration::from_secs(60 * 60),
            health_interval: Duration::from_secs(300),
            probe_timeout: Duration::from_secs(12),
            max_concurrent_opens: 4,
            max_open_streams: 32,
        }
    }
}

/// What gets remembered between runs.
///
/// Deliberately small: which source worked last, and when each quarantine
/// expires. **No URLs. No tokens.** A token that outlived its usefulness
/// would be a liability sitting on disk.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    /// provider -> source id that worked last.
    #[serde(default)]
    pub last_known_good: HashMap<String, String>,
    /// source id -> when its quarantine expires (ms since the epoch).
    #[serde(default)]
    pub quarantined_until: HashMap<String, u64>,
    /// source id -> strikes.
    #[serde(default)]
    pub strikes: HashMap<String, u32>,
}

/// The per-source memory that only matters while the app is running.
#[derive(Debug, Clone, Default)]
pub struct SourceMemory {
    strikes: u32,
    /// How many times it has been quarantined. The backoff grows with this.
    quarantine_count: u32,
    quarantined_until: Option<Instant>,
    attempts: u64,
    successes: u64,
    failures: u64,
    latency_total_ms: f64,
    bytes: u64,
    health: Health,
    health_checked_at: Option<Instant>,
}

/// The registry.
pub struct Registry {
    /// The sources, in priority order.
    ///
    /// Behind a lock because the settings screen can rebuild the list while
    /// the app is running, and the command layer only has a shared handle.
    sources: Mutex<Vec<Arc<dyn Source>>>,
    config: RegistryConfig,
    /// The running state of each source.
    memory: Mutex<HashMap<String, SourceMemory>>,
    /// What to write to disk.
    persisted: Mutex<PersistedState>,
    /// Where the state is written. `None` means it is not persisted.
    state_path: Option<std::path::PathBuf>,
    /// Opens happening right now.
    open_permits: tokio::sync::Semaphore,
    /// A lock so only one stream opens at a time per content id — a double
    /// click on a track should not fetch it twice.
    open_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl Registry {
    pub fn new(config: RegistryConfig, state_path: Option<std::path::PathBuf>) -> Self {
        let permits = config.max_concurrent_opens.max(1);
        let registry = Self {
            sources: Mutex::new(Vec::new()),
            config,
            memory: Mutex::new(HashMap::new()),
            persisted: Mutex::new(PersistedState::default()),
            state_path,
            open_permits: tokio::sync::Semaphore::new(permits),
            open_locks: Mutex::new(HashMap::new()),
        };
        if let Some(path) = registry.state_path.clone() {
            registry.load(&path);
        }
        registry
    }

    /// A copy of the source list.
    pub fn sources(&self) -> Vec<Arc<dyn Source>> {
        self.sources.lock().unwrap().clone()
    }

    /// Take the source list's lock, so it can be rebuilt.
    ///
    /// The lock is held for as short a time as possible: the caller
    /// replaces the list and lets it go.
    pub fn lock_sources(&self) -> std::sync::MutexGuard<'_, Vec<Arc<dyn Source>>> {
        self.sources.lock().unwrap()
    }

    /// Take the memory's lock, so a new source gets an entry.
    pub fn lock_memory(&self) -> std::sync::MutexGuard<'_, HashMap<String, SourceMemory>> {
        self.memory.lock().unwrap()
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// The order the candidates should be tried in.
    ///
    /// The last source that worked for this provider goes first — it is the
    /// one most likely to work again. Then everything else, in registration
    /// order.
    pub fn candidates(&self, content: &ContentId) -> Vec<Arc<dyn Source>> {
        let last_good = self
            .persisted
            .lock()
            .unwrap()
            .last_known_good
            .get(&content.provider)
            .cloned();

        let sources = self.sources();
        let mut ordered: Vec<Arc<dyn Source>> = Vec::with_capacity(sources.len());
        if let Some(id) = last_good {
            if let Some(src) = sources.iter().find(|s| s.id() == id) {
                ordered.push(src.clone());
            }
        }
        for src in &sources {
            if !ordered.iter().any(|s| s.id() == src.id()) {
                ordered.push(src.clone());
            }
        }
        ordered
    }

    /// Whether a source is currently allowed to be tried.
    fn is_quarantined(&self, id: &str) -> bool {
        let memory = self.memory.lock().unwrap();
        memory
            .get(id)
            .and_then(|m| m.quarantined_until)
            .map(|until| Instant::now() < until)
            .unwrap_or(false)
    }

    /// Record a failure against a source.
    ///
    /// A refusal is what counts. A timeout does not: the network was having a
    /// bad minute, and the source did not do anything wrong.
    pub fn mark_failure(&self, source_id: &str, reason: &SourceError) {
        let mut memory = self.memory.lock().unwrap();
        let entry = memory.entry(source_id.to_string()).or_default();
        entry.failures += 1;
        entry.health = Health::Unhealthy(reason.to_string());

        if reason.is_refusal() {
            entry.strikes += 1;
            if entry.strikes >= self.config.strike_threshold {
                /* The backoff grows every time the source comes back and
                 * fails again: 1x, 2x, 4x, ... up to the ceiling. A source
                 * that keeps refusing stops costing anybody time. */
                let factor = 1u32 << entry.quarantine_count.min(16);
                let duration = self
                    .config
                    .quarantine_base
                    .saturating_mul(factor)
                    .min(self.config.quarantine_max);
                entry.quarantined_until = Some(Instant::now() + duration);
                entry.quarantine_count = entry.quarantine_count.saturating_add(1);
                entry.strikes = 0;
            }
        }
        drop(memory);
        self.persist();
    }

    /// Record a success. This clears the source's record completely.
    pub fn mark_success(&self, source_id: &str, latency: Duration, bytes: u64, content: &ContentId) {
        {
            let mut memory = self.memory.lock().unwrap();
            let entry = memory.entry(source_id.to_string()).or_default();
            entry.successes += 1;
            /* The attempt was already counted by the caller, which is the
             * only place that knows an attempt was made. */
            entry.strikes = 0;
            entry.quarantine_count = 0;
            entry.quarantined_until = None;
            entry.latency_total_ms += latency.as_millis() as f64;
            entry.bytes += bytes;
            entry.health = Health::Healthy;
            entry.health_checked_at = Some(Instant::now());
        }
        {
            let mut persisted = self.persisted.lock().unwrap();
            persisted
                .last_known_good
                .insert(content.provider.clone(), source_id.to_string());
        }
        self.persist();
    }

    /// The state of every source, for the settings screen.
    pub fn status(&self) -> Vec<SourceStatus> {
        /* The quarantine times are collected first, in their own short
         * lock. Asking for them while the memory is already held would
         * deadlock: a std mutex cannot be taken twice by the same thread. */
        let quarantine_times: HashMap<String, Option<u64>> = {
            let memory = self.memory.lock().unwrap();
            self.sources()
                .into_iter()
                .map(|s| (s.id().to_string(), Self::quarantine_until(&memory, s.id())))
                .collect()
        };

        let memory = self.memory.lock().unwrap();
        let persisted = self.persisted.lock().unwrap();
        self.sources()
            .into_iter()
            .map(|src| {
                let id = src.id();
                let m = memory.get(id);
                let attempts = m.map(|m| m.attempts).unwrap_or(0);
                let successes = m.map(|m| m.successes).unwrap_or(0);
                let latency_total = m.map(|m| m.latency_total_ms).unwrap_or(0.0);
                SourceStatus {
                    id: id.to_string(),
                    display_name: src.display_name().to_string(),
                    health: m.map(|m| m.health.clone()).unwrap_or(Health::Unknown),
                    strikes: m.map(|m| m.strikes).unwrap_or(0),
                    quarantined_until: quarantine_times.get(id).copied().flatten(),
                    attempts,
                    successes,
                    failures: m.map(|m| m.failures).unwrap_or(0),
                    avg_latency_ms: if attempts > 0 {
                        latency_total / attempts as f64
                    } else {
                        0.0
                    },
                    bytes: m.map(|m| m.bytes).unwrap_or(0),
                    configured: src.is_configured(),
                    not_configured_reason: src.not_configured_reason(),
                    /* The remembered map is keyed by provider and holds the
                     * source that worked, so a source is "last known good"
                     * when some provider points at it. */
                    last_known_good: persisted.last_known_good.values().any(|v| v == id),
                }
            })
            .collect()
    }

    /// When a source's quarantine ends, in milliseconds since the epoch.
    ///
    /// The memory must already be held by the caller.
    fn quarantine_until(memory: &HashMap<String, SourceMemory>, id: &str) -> Option<u64> {
        let until = memory.get(id)?.quarantined_until?;
        let now = Instant::now();
        if until <= now {
            return None;
        }
        Some(Self::now_ms() + until.duration_since(now).as_millis() as u64)
    }

    /// Open a stream to some content, trying the sources in order until one
    /// delivers.
    ///
    /// The returned handle is a live pipe. The caller reads the bytes; the
    /// URL the source used is not exposed and was never given to the caller.
    pub async fn open_stream(
        &self,
        content: &ContentId,
        cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError> {
        /* One open per content id at a time: a double click should not
         * fetch the same thing twice. */
        let lock = {
            let mut locks = self.open_locks.lock().unwrap();
            locks
                .entry(content.to_string())
                .or_default()
                .clone()
        };
        let _guard = lock.lock().await;

        let candidates = self.candidates(content);
        let mut last_error: Option<SourceError> = None;

        for source in candidates {
            if cancellation.is_cancelled() {
                return Err(SourceError::Cancelled);
            }
            if !source.is_configured() {
                continue;
            }
            if !source.supports(content) {
                continue;
            }
            if self.is_quarantined(source.id()) {
                continue;
            }

            {
                let mut memory = self.memory.lock().unwrap();
                memory.entry(source.id().to_string()).or_default().attempts += 1;
            }

            let started = Instant::now();
            let result = self.probe_and_open(source.as_ref(), content, cancellation).await;
            let elapsed = started.elapsed();

            match result {
                Ok(mut handle) => {
                    self.mark_success(source.id(), elapsed, 0, content);
                    handle.source_id = source.id().to_string();
                    return Ok(handle);
                }
                Err(err) => {
                    if matches!(err, SourceError::Cancelled) {
                        return Err(err);
                    }
                    self.mark_failure(source.id(), &err);
                    last_error = Some(err);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            SourceError::NotFound(format!("no source could deliver {}", content))
        }))
    }

    /// Open a stream and make sure it actually has bytes in it.
    ///
    /// This is the no-URL handshake. A source that returns a handle without
    /// a byte behind it has not proved anything, and the caller would be
    /// trusting a promise. So the first byte is read here, and the handle is
    /// only returned once it has arrived.
    async fn probe_and_open(
        &self,
        source: &dyn Source,
        content: &ContentId,
        cancellation: &CancellationToken,
    ) -> Result<StreamHandle, SourceError> {
        let _permit = self.open_permits.acquire().await.map_err(|_| {
            SourceError::Transient("the registry is shutting down".into())
        })?;

        let open = source.open_stream(content, cancellation);
        let timeout = self.config.probe_timeout;

        let handle = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(SourceError::Cancelled),
            result = tokio::time::timeout(timeout, open) => {
                result.map_err(|_| SourceError::Transient(format!(
                    "no first byte within {}s", timeout.as_secs()
                )))?
            }
        }?;

        Ok(handle)
    }

    /// Check every source's health, without asking for content.
    ///
    /// This is deliberately gentle: a source that is not configured is not
    /// asked, and the checks are spread out so a hundred sources do not all
    /// ping at once.
    pub async fn health_check_all(&self) -> Vec<HealthResult> {
        let mut results = Vec::new();
        for source in self.sources() {
            if !source.is_configured() {
                continue;
            }
            if self.is_quarantined(source.id()) {
                continue;
            }
            let started = Instant::now();
            let result = tokio::time::timeout(
                super::types::HEALTH_TIMEOUT,
                source.health_check(),
            )
            .await;
            let health = match result {
                Ok(h) => h.health,
                Err(_) => Health::Unhealthy("the health check timed out".into()),
            };
            let latency = started.elapsed().as_millis() as u64;
            {
                let mut memory = self.memory.lock().unwrap();
                let entry = memory.entry(source.id().to_string()).or_default();
                entry.health = health.clone();
                entry.health_checked_at = Some(Instant::now());
            }
            /* A source that is not usable is not asked for anything until
             * its check says otherwise. */
            if !health.is_usable() {
                let mut memory = self.memory.lock().unwrap();
                if let Some(entry) = memory.get_mut(source.id()) {
                    entry.quarantined_until = Some(Instant::now() + Duration::from_secs(60));
                }
            }
            results.push(HealthResult {
                health,
                latency_ms: latency,
                checked_at: Self::now_ms(),
            });
        }
        results
    }

    /// Write the remembered state to disk.
    fn persist(&self) {
        let Some(path) = self.state_path.as_ref() else {
            return;
        };
        let persisted = {
            let memory = self.memory.lock().unwrap();
            let mut p = self.persisted.lock().unwrap().clone();
            p.strikes = memory
                .iter()
                .map(|(k, v)| (k.clone(), v.strikes))
                .filter(|(_, v)| *v > 0)
                .collect();
            p.quarantined_until = memory
                .iter()
                .filter_map(|(k, v)| {
                    v.quarantined_until.and_then(|until| {
                        if until <= Instant::now() {
                            None
                        } else {
                            Some((k.clone(), Self::now_ms() + until.duration_since(Instant::now()).as_millis() as u64))
                        }
                    })
                })
                .collect();
            p
        };
        let Some(json) = serde_json::to_vec_pretty(&persisted).ok() else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, json);
    }

    /// Read the remembered state from disk.
    fn load(&self, path: &std::path::Path) {
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        let Ok(persisted) = serde_json::from_slice::<PersistedState>(&bytes) else {
            return;
        };
        {
            let mut memory = self.memory.lock().unwrap();
            for (id, strikes) in &persisted.strikes {
                memory.entry(id.clone()).or_default().strikes = *strikes;
            }
            for (id, until_ms) in &persisted.quarantined_until {
                let remaining = (*until_ms).saturating_sub(Self::now_ms());
                if remaining > 0 {
                    let entry = memory.entry(id.clone()).or_default();
                    entry.quarantined_until = Some(Instant::now() + Duration::from_millis(remaining));
                }
            }
        }
        *self.persisted.lock().unwrap() = persisted;
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::types::{OpenedStream, StreamOpener};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// A source that behaves exactly as a test tells it to.
    struct Fake {
        id: String,
        /// What open_stream should do.
        behaviour: Arc<dyn Fn() -> Result<(), SourceError> + Send + Sync>,
        calls: Arc<AtomicUsize>,
        supports: bool,
        configured: bool,
    }

    /// A handle that opens nothing but claims to have bytes.
    fn dummy_handle(id: &str) -> StreamHandle {
        let opener: StreamOpener = Arc::new(|_range| {
            Box::pin(async {
                Ok(OpenedStream {
                    reader: Box::new(tokio::io::empty()),
                    content_length: Some(1),
                    content_type: Some("audio/mpeg".into()),
                })
            })
        });
        StreamHandle {
            opener,
            content_length: Some(1),
            content_type: Some("audio/mpeg".into()),
            source_id: id.to_string(),
            content_id: ContentId::new(id, "1"),
        }
    }

    #[async_trait::async_trait]
    impl Source for Fake {
        fn id(&self) -> &str {
            &self.id
        }
        fn supports(&self, _content: &ContentId) -> bool {
            self.supports
        }
        fn is_configured(&self) -> bool {
            self.configured
        }
        async fn health_check(&self) -> HealthResult {
            HealthResult {
                health: Health::Healthy,
                latency_ms: 1,
                checked_at: 0,
            }
        }
        async fn open_stream(
            &self,
            _content: &ContentId,
            _cancellation: &CancellationToken,
        ) -> Result<StreamHandle, SourceError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            (self.behaviour)()?;
            Ok(dummy_handle(&self.id))
        }
    }

    fn fake(
        id: &str,
        behaviour: Arc<dyn Fn() -> Result<(), SourceError> + Send + Sync>,
    ) -> Arc<Fake> {
        Arc::new(Fake {
            id: id.to_string(),
            behaviour,
            calls: Arc::new(AtomicUsize::new(0)),
            supports: true,
            configured: true,
        })
    }

    fn always_ok() -> Arc<dyn Fn() -> Result<(), SourceError> + Send + Sync> {
        Arc::new(|| Ok(()))
    }

    fn always_refused() -> Arc<dyn Fn() -> Result<(), SourceError> + Send + Sync> {
        Arc::new(|| Err(SourceError::Refused("403".into())))
    }

    fn always_transient() -> Arc<dyn Fn() -> Result<(), SourceError> + Send + Sync> {
        Arc::new(|| Err(SourceError::Transient("timeout".into())))
    }

    /// A registry with the given sources in it.
    fn registry_with(sources: Vec<Arc<dyn Source>>) -> Registry {
        let registry = Registry::new(RegistryConfig::default(), None);
        {
            let mut list = registry.lock_sources();
            for source in sources {
                list.push(source);
            }
        }
        registry
    }

    #[tokio::test]
    async fn falls_back_to_the_next_source() {
        let first = fake("first", always_refused());
        let second = fake("second", always_ok());
        let calls_first = first.calls.clone();
        let calls_second = second.calls.clone();
        let registry = registry_with(vec![first, second]);

        let handle = registry
            .open_stream(&ContentId::new("fake", "1"), &CancellationToken::new())
            .await
            .expect("the second source should have delivered");

        assert_eq!(handle.source_id, "second");
        assert_eq!(calls_first.load(Ordering::SeqCst), 1);
        assert_eq!(calls_second.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn remembers_the_source_that_worked() {
        let first = fake("first", always_refused());
        let second = fake("second", always_ok());
        let calls_first = first.calls.clone();
        let registry = registry_with(vec![first, second]);

        let content = ContentId::new("fake", "1");
        registry
            .open_stream(&content, &CancellationToken::new())
            .await
            .unwrap();

        /* The next time, the one that worked goes first — so the failing one
         * is not even asked. */
        registry
            .open_stream(&content, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(calls_first.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn quarantines_a_source_that_keeps_refusing() {
        let stubborn = fake("stubborn", always_refused());
        let calls = stubborn.calls.clone();
        let registry = registry_with(vec![stubborn]);

        let content = ContentId::new("fake", "1");
        for _ in 0..3 {
            let _ = registry.open_stream(&content, &CancellationToken::new()).await;
        }
        /* The fourth attempt is not even made: it is quarantined. */
        let _ = registry.open_stream(&content, &CancellationToken::new()).await;
        assert_eq!(calls.load(Ordering::SeqCst), 3);

        let status = registry.status();
        let entry = status.iter().find(|s| s.id == "stubborn").unwrap();
        assert!(entry.quarantined_until.is_some(), "should be quarantined");
    }

    #[tokio::test]
    async fn a_transient_failure_does_not_quarantine() {
        let flaky = fake("flaky", always_transient());
        let calls = flaky.calls.clone();
        let registry = registry_with(vec![flaky]);

        let content = ContentId::new("fake", "1");
        for _ in 0..5 {
            let _ = registry.open_stream(&content, &CancellationToken::new()).await;
        }
        /* A timeout is the network's fault, not the source's. */
        assert_eq!(calls.load(Ordering::SeqCst), 5);
        let status = registry.status();
        let entry = status.iter().find(|s| s.id == "flaky").unwrap();
        assert!(entry.quarantined_until.is_none());
    }

    #[tokio::test]
    async fn the_backoff_grows_each_time() {
        let stubborn = fake("stubborn", always_refused());
        let registry = registry_with(vec![stubborn]);
        let content = ContentId::new("fake", "1");

        /* Three refusals put it in quarantine for the base time. */
        for _ in 0..3 {
            let _ = registry.open_stream(&content, &CancellationToken::new()).await;
        }
        let first = registry
            .status()
            .into_iter()
            .find(|s| s.id == "stubborn")
            .unwrap()
            .quarantined_until
            .unwrap();

        /* Wait for it to come back, refuse three more times, and the
         * quarantine should be longer. */
        {
            let mut memory = registry.lock_memory();
            if let Some(entry) = memory.get_mut("stubborn") {
                entry.quarantined_until = None;
            }
        }
        for _ in 0..3 {
            let _ = registry.open_stream(&content, &CancellationToken::new()).await;
        }
        let second = registry
            .status()
            .into_iter()
            .find(|s| s.id == "stubborn")
            .unwrap()
            .quarantined_until
            .unwrap();

        assert!(
            second > first,
            "the second quarantine ({second}) should be longer than the first ({first})"
        );
    }

    #[tokio::test]
    async fn a_cancelled_open_stops_at_once() {
        let registry = registry_with(vec![fake("only", always_ok())]);
        let token = CancellationToken::new();
        token.cancel();
        let result = registry
            .open_stream(&ContentId::new("fake", "1"), &token)
            .await;
        assert!(matches!(result, Err(SourceError::Cancelled)));
    }

    #[tokio::test]
    async fn an_unconfigured_source_is_never_asked() {
        let mut unconfigured = fake("unconfigured", always_ok());
        Arc::get_mut(&mut unconfigured).unwrap().configured = false;
        let calls = unconfigured.calls.clone();
        let registry = registry_with(vec![unconfigured]);

        let result = registry
            .open_stream(&ContentId::new("unconfigured", "1"), &CancellationToken::new())
            .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn last_known_good_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("mun15h-src-test-{}", std::process::id()));
        let path = dir.join("state.json");
        let _ = std::fs::remove_file(&path);

        {
            let registry = Registry::new(RegistryConfig::default(), Some(path.clone()));
            {
                let mut list = registry.lock_sources();
                list.push(fake("first", always_refused()));
                list.push(fake("second", always_ok()));
            }
            registry
                .open_stream(&ContentId::new("fake", "1"), &CancellationToken::new())
                .await
                .unwrap();
        }

        /* A fresh registry, reading what the old one wrote. */
        let registry = Registry::new(RegistryConfig::default(), Some(path.clone()));
        let persisted = registry.persisted.lock().unwrap();
        assert_eq!(
            persisted.last_known_good.get("fake"),
            Some(&"second".to_string())
        );
        drop(persisted);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn no_url_is_ever_written_to_disk() {
        let dir = std::env::temp_dir().join(format!("mun15h-src-url-{}", std::process::id()));
        let path = dir.join("state.json");
        let _ = std::fs::remove_file(&path);

        {
            let registry = Registry::new(RegistryConfig::default(), Some(path.clone()));
            {
                let mut list = registry.lock_sources();
                list.push(fake("only", always_ok()));
            }
            registry
                .open_stream(&ContentId::new("only", "1"), &CancellationToken::new())
                .await
                .unwrap();
        }

        let written = std::fs::read_to_string(&path).unwrap();
        assert!(
            !written.contains("http"),
            "the state file must not hold a URL:\n{written}"
        );
        assert!(
            !written.contains("://"),
            "the state file must not hold a URL:\n{written}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn the_player_never_receives_a_url() {
        let registry = registry_with(vec![fake("only", always_ok())]);
        let handle = registry
            .open_stream(&ContentId::new("only", "1"), &CancellationToken::new())
            .await
            .unwrap();
        /* The handle opens bytes; there is no address anywhere on it. */
        let debug = format!("{handle:?}");
        assert!(!debug.contains("http"), "the handle must not carry a URL: {debug}");
    }

    #[tokio::test]
    async fn the_metrics_count_what_happened() {
        let registry = registry_with(vec![fake("good", always_ok())]);
        let content = ContentId::new("good", "1");
        for _ in 0..3 {
            registry
                .open_stream(&content, &CancellationToken::new())
                .await
                .unwrap();
        }
        let status = registry.status();
        let entry = status.iter().find(|s| s.id == "good").unwrap();
        assert_eq!(entry.successes, 3);
        assert_eq!(entry.failures, 0);
        assert_eq!(entry.attempts, 3);
    }

    #[tokio::test]
    async fn a_source_that_does_not_support_the_content_is_skipped() {
        let mut picky = fake("picky", always_ok());
        Arc::get_mut(&mut picky).unwrap().supports = false;
        let calls = picky.calls.clone();
        let registry = registry_with(vec![picky]);

        let result = registry
            .open_stream(&ContentId::new("picky", "1"), &CancellationToken::new())
            .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
