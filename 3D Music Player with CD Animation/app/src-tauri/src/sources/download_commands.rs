//! The commands the online section calls for downloads.
//!
//! A download runs in the background: the command queues it and returns
//! at once, and the panel asks the queue how it is doing. That is what
//! makes the queue feel like a queue rather than a hang.

use std::sync::Arc;

use tauri::State;

use super::downloads::{DownloadQueue, Job, JobStatus};

/// The queue, and the tools it needs to fetch.
pub struct DownloadState {
    pub queue: Arc<DownloadQueue>,
    /// Where the files go.
    pub download_dir: std::path::PathBuf,
    /// Whether to put each artist's songs in a folder of their own.
    pub organise_by_artist: bool,
    /// The `yt-dlp` program, for the fetches the direct resolver will not
    /// do.
    pub program: std::path::PathBuf,
    /// The session's cookies, for the same reason.
    pub cookies: Option<std::path::PathBuf>,
}

/// Every job, in the order they were queued.
#[tauri::command]
pub async fn downloads_list(
    state: State<'_, DownloadState>,
) -> Result<Vec<Job>, String> {
    Ok(state.queue.list().await)
}

/// One job.
#[tauri::command]
pub async fn downloads_get(
    id: String,
    state: State<'_, DownloadState>,
) -> Result<Option<Job>, String> {
    Ok(state.queue.get(&id).await)
}

/// Queue a download and start it.
#[tauri::command]
pub async fn downloads_add(
    video_id: String,
    title: String,
    artist: String,
    album: String,
    state: State<'_, DownloadState>,
) -> Result<String, String> {
    let id = state
        .queue
        .enqueue(&video_id, &title, &artist, &album)
        .await;
    let worker = DownloadWorker {
        queue: state.queue.clone(),
        organise_by_artist: state.organise_by_artist,
        program: state.program.clone(),
        cookies: state.cookies.clone(),
    };
    /* The download runs on its own task, so the command returns at once
     * and the panel can watch it happen. */
    let job_id = id.clone();
    tauri::async_runtime::spawn(async move {
        worker.run(job_id, video_id, title, artist, album).await;
    });
    Ok(id)
}

/// Forget a job.
#[tauri::command]
pub async fn downloads_remove(
    id: String,
    state: State<'_, DownloadState>,
) -> Result<bool, String> {
    Ok(state.queue.remove(&id).await)
}

/// Forget every finished job.
#[tauri::command]
pub async fn downloads_clear_finished(
    state: State<'_, DownloadState>,
) -> Result<usize, String> {
    Ok(state.queue.clear_finished().await)
}

/// Where the files are going.
#[tauri::command]
pub fn downloads_folder(state: State<'_, DownloadState>) -> String {
    state.download_dir.to_string_lossy().to_string()
}

/// The work of one download.
struct DownloadWorker {
    queue: Arc<DownloadQueue>,
    organise_by_artist: bool,
    program: std::path::PathBuf,
    cookies: Option<std::path::PathBuf>,
}

impl DownloadWorker {
    async fn run(
        &self,
        id: String,
        video_id: String,
        title: String,
        artist: String,
        _album: String,
    ) {
        /* Only so many at a time. */
        let _permit = self.queue.slot().await;

        self.queue
            .update(&id, |job| {
                job.status = JobStatus::Running;
                job.message = "FINDING THE BEST SOURCE".into();
            })
            .await;

        /* The file name, and the folder it goes in. */
        let path = self
            .queue
            .path_for(&title, &artist, self.organise_by_artist);
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                self.fail(&id, format!("could not make the folder: {e}")).await;
                return;
            }
        }
        let target = path.to_string_lossy().to_string();

        /* The fetch. */
        self.queue
            .update(&id, |job| {
                job.message = "DOWNLOADING".into();
            })
            .await;

        match self.fetch(&video_id, &target, &id).await {
            Ok(()) => {
                self.queue
                    .update(&id, |job| {
                        job.status = JobStatus::Done;
                        job.progress = 1.0;
                        job.message = "DONE".into();
                        job.filename = Some(target.clone());
                    })
                    .await;
            }
            Err(e) => self.fail(&id, e).await,
        }
    }

    /// Fetch the audio to a file.
    async fn fetch(&self, video_id: &str, target: &str, id: &str) -> Result<(), String> {
        let mut command = tokio::process::Command::new(&self.program);
        command
            .arg("--no-warnings")
            .arg("--ignore-config")
            .arg("--no-playlist")
            .arg("--extract-audio")
            .arg("--audio-format")
            .arg("m4a")
            .arg("--output")
            .arg(target)
            .arg(format!("https://www.youtube.com/watch?v={video_id}"))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(cookies) = &self.cookies {
            command.arg("--cookies").arg(cookies);
        }

        let output = tokio::time::timeout(
            super::downloads::DOWNLOAD_TIMEOUT,
            command.output(),
        )
        .await
        .map_err(|_| "the download took too long".to_string())?
        .map_err(|e| format!("could not run yt-dlp: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let message = stderr
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("the download failed")
                .to_string();
            return Err(message);
        }

        /* yt-dlp may have changed the extension on the way. */
        let stem = target.trim_end_matches(".m4a");
        for candidate in [
            format!("{stem}.m4a"),
            format!("{stem}.mp3"),
            format!("{stem}.webm"),
        ] {
            if std::path::Path::new(&candidate).exists() {
                let size = std::fs::metadata(&candidate).map(|m| m.len()).unwrap_or(0);
                self.queue
                    .update(id, |job| {
                        job.received_bytes = size;
                        job.total_bytes = Some(size);
                        job.filename = Some(candidate);
                    })
                    .await;
                return Ok(());
            }
        }
        Err("the download finished but the file was not where it should be".into())
    }

    async fn fail(&self, id: &str, message: String) {
        self.queue
            .update(id, |job| {
                job.status = JobStatus::Failed;
                job.message = "FAILED".into();
                job.error = Some(message);
            })
            .await;
    }
}
