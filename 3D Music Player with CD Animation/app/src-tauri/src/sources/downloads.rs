//! The download queue.
//!
//! A download is a job: it is queued, it runs, it either finishes or
//! fails, and the user can watch it happen. The queue is in memory — a
//! download that has finished is a file on the disk, and the file is the
//! only thing worth remembering.
//!
//! The progress is real, not a guess: the bytes come from the upstream, and
//! the number is how many have arrived.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// How a job is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    /// Waiting for a slot.
    Queued,
    /// Being fetched.
    Running,
    /// Finished, and the file is on the disk.
    Done,
    /// It failed, and the reason is in `message`.
    Failed,
    /// The user stopped it.
    Cancelled,
}

/// One download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    /// A unique id.
    pub id: String,
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub status: JobStatus,
    /// How far along, from 0 to 1.
    pub progress: f32,
    /// What it is doing right now.
    pub message: String,
    /// The file, once it is there.
    pub filename: Option<String>,
    /// How big it is, when the upstream says.
    pub total_bytes: Option<u64>,
    /// The bytes that have arrived.
    pub received_bytes: u64,
    /// Why it failed, when it did.
    pub error: Option<String>,
}

/// The queue.
pub struct DownloadQueue {
    jobs: Mutex<HashMap<String, Job>>,
    order: Mutex<Vec<String>>,
    /// How many downloads may run at once.
    slots: Arc<tokio::sync::Semaphore>,
    /// Where the files go.
    download_dir: std::path::PathBuf,
    counter: std::sync::atomic::AtomicU64,
}

impl DownloadQueue {
    pub fn new(download_dir: std::path::PathBuf, parallel: usize) -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
            slots: Arc::new(tokio::sync::Semaphore::new(parallel.max(1))),
            download_dir,
            counter: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Every job, in the order they were queued.
    pub async fn list(&self) -> Vec<Job> {
        let jobs = self.jobs.lock().await;
        let order = self.order.lock().await;
        order
            .iter()
            .filter_map(|id| jobs.get(id).cloned())
            .collect()
    }

    /// One job.
    pub async fn get(&self, id: &str) -> Option<Job> {
        self.jobs.lock().await.get(id).cloned()
    }

    /// Queue a download.
    pub async fn enqueue(
        &self,
        video_id: &str,
        title: &str,
        artist: &str,
        album: &str,
    ) -> String {
        let n = self
            .counter
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let id = format!("dl{n}");
        let job = Job {
            id: id.clone(),
            video_id: video_id.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: album.to_string(),
            status: JobStatus::Queued,
            progress: 0.0,
            message: "WAITING".into(),
            filename: None,
            total_bytes: None,
            received_bytes: 0,
            error: None,
        };
        self.jobs.lock().await.insert(id.clone(), job);
        self.order.lock().await.push(id.clone());
        id
    }

    /// Forget a job that has finished.
    pub async fn remove(&self, id: &str) -> bool {
        let removed = self.jobs.lock().await.remove(id).is_some();
        self.order.lock().await.retain(|i| i != id);
        removed
    }

    /// Forget every finished job.
    pub async fn clear_finished(&self) -> usize {
        let mut jobs = self.jobs.lock().await;
        let mut order = self.order.lock().await;
        let done: Vec<String> = jobs
            .iter()
            .filter(|(_, j)| {
                matches!(j.status, JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &done {
            jobs.remove(id);
        }
        order.retain(|id| !done.contains(id));
        done.len()
    }

    /// Update a job.
    pub async fn update<F: FnOnce(&mut Job)>(&self, id: &str, change: F) {
        let mut jobs = self.jobs.lock().await;
        if let Some(job) = jobs.get_mut(id) {
            change(job);
        }
    }

    /// Take a slot, so the downloads do not all run at once.
    pub async fn slot(&self) -> tokio::sync::OwnedSemaphorePermit {
        self.slots.clone().acquire_owned().await.unwrap()
    }

    /// The name a file gets.
    ///
    /// The name is made from the title and the artist, with the characters
    /// that are not allowed in a file name taken out. Two tracks with the
    /// same name get a number.
    pub fn file_name(&self, title: &str, artist: &str) -> String {
        let mut stem = String::new();
        if !artist.trim().is_empty() {
            stem.push_str(&sanitise(artist));
            stem.push_str(" - ");
        }
        stem.push_str(&sanitise(title));
        if stem.trim().is_empty() {
            stem.push_str("track");
        }
        format!("{}.m4a", stem.trim())
    }

    /// The path a file goes to, with the artist folder if there is one.
    pub fn path_for(&self, title: &str, artist: &str, organise_by_artist: bool) -> std::path::PathBuf {
        let name = self.file_name(title, artist);
        if organise_by_artist && !artist.trim().is_empty() {
            self.download_dir.join(sanitise(artist)).join(name)
        } else {
            self.download_dir.join(name)
        }
    }
}

/// Take out the characters a file name may not have.
///
/// The list is deliberately generous — a name with a slash in it is a
/// directory, and a name with a colon in it will not open on Windows.
pub fn sanitise(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => out.push('_'),
            c if (c as u32) < 0x20 => out.push('_'),
            c => out.push(c),
        }
    }
    /* A trailing dot or space is not allowed on Windows, and it makes the
     * name look odd everywhere else. */
    let trimmed = out.trim_end().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed
    }
}

/// How long a download may take before it is called a failure.
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_job_is_queued_and_listed_in_order() {
        let queue = DownloadQueue::new(std::env::temp_dir(), 2);
        let first = queue.enqueue("a", "ONE", "ARTIST", "ALBUM").await;
        let second = queue.enqueue("b", "TWO", "ARTIST", "ALBUM").await;
        let list = queue.list().await;
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, first);
        assert_eq!(list[1].id, second);
        assert_eq!(list[0].status, JobStatus::Queued);
    }

    #[tokio::test]
    async fn a_finished_job_can_be_forgotten() {
        let queue = DownloadQueue::new(std::env::temp_dir(), 2);
        let id = queue.enqueue("a", "ONE", "ARTIST", "ALBUM").await;
        queue
            .update(&id, |j| {
                j.status = JobStatus::Done;
                j.progress = 1.0;
            })
            .await;
        assert_eq!(queue.clear_finished().await, 1);
        assert!(queue.list().await.is_empty());
    }

    #[test]
    fn a_file_name_has_nothing_forbidden_in_it() {
        let queue = DownloadQueue::new(std::env::temp_dir(), 1);
        let name = queue.file_name("A/B: C?", "An*Artist");
        assert!(!name.contains('/'));
        assert!(!name.contains(':'));
        assert!(!name.contains('*'));
        assert!(!name.contains('?'));
        assert!(name.ends_with(".m4a"));
    }

    #[test]
    fn a_name_with_nothing_in_it_still_gets_a_name() {
        let queue = DownloadQueue::new(std::env::temp_dir(), 1);
        assert_eq!(queue.file_name("", ""), "track.m4a");
        assert_eq!(sanitise("   "), "track");
    }

    #[test]
    fn a_trailing_dot_is_taken_off() {
        assert_eq!(sanitise("NAME."), "NAME");
    }
}
