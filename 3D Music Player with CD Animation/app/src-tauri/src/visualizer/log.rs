//! A log the app writes while it runs.
//!
//! The visualiser has two halves — a native engine and the interface that
//! feeds it — and when something goes wrong the only useful answer is a
//! timeline of both. So there is ONE log file, in the system temporary
//! directory, and both halves write to it.
//!
//! The engine writes the frame timings (which is where a stutter shows up)
//! and the interface writes what it is doing about the audio.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

static LOG: OnceLock<Option<Mutex<File>>> = OnceLock::new();

/// where the log is
///
/// ONE file for every session, deliberately: the interesting question is
/// usually "what happened across these runs", and a file per run would
/// scatter that.
pub fn path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push("mun15h-visualiser.log");
    p
}

/// Open the log. Called once, by the engine, when it starts.
///
/// The file APPENDS: a session is a run of the app, and the interesting
/// thing is usually what happened across several of them — a track that
/// plays on Monday and not on Tuesday. Truncating would throw exactly that
/// away.
pub fn open() {
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(path())
        .ok();
    let _ = LOG.set(file.map(Mutex::new));
    write("=== a session ===");
}

/// Write one line. Safe from any thread, and never throws: a log that can
/// crash the app is worse than no log.
pub fn write(line: &str) {
    let Some(slot) = LOG.get() else {
        return;
    };
    let Some(file) = slot.as_ref() else {
        return;
    };
    let stamp = stamp();
    if let Ok(mut f) = file.lock() {
        let _ = writeln!(f, "[{stamp}] {line}");
        let _ = f.flush();
    }
}

/// Write one line, from the interface side.
#[tauri::command]
pub fn visualizer_log(line: String) {
    write(&format!("[interface] {line}"));
}

/// a wall-clock stamp, to the millisecond
fn stamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    /* days since the epoch, turned into a date by hand — no date library
       for the sake of a log line */
    let days = (secs / 86_400) as i64;
    let tod = (secs % 86_400) as u32;
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}.{millis:03}")
}

/// the civil date from a day count — Howard Hinnant's algorithm
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
