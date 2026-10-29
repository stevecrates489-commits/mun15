//! The visualiser's commands.
//!
//! Everything the app can ask of the engine goes through here, and every
//! answer comes back as plain data the frontend can read. The commands are
//! thin: they turn a request into a message for the engine thread and, where
//! the answer is known without the engine (the preset folder, for one), do
//! the work directly.
//!
//! The log is here too: the interface's half of the story goes into the same
//! file as the engine's, so one file tells the whole story.
//!
//! ── BUILD NOTES ────────────────────────────────────────────────────────
//!
//! This half is native and has to be compiled on the machine that runs the
//! app. `cargo build` (or `npm run tauri dev`) is enough; there is nothing
//! to install and nothing to generate.
//!
//! The engine is the `lactea` crate, which draws through `wgpu`. Both are
//! pinned in Cargo.toml, and `wgpu` is pinned to the same major as the
//! engine's own dependency ON PURPOSE: the engine's configuration takes a
//! `wgpu::TextureFormat`, and that has to be the very same type as ours, so
//! Cargo has to resolve both to one crate instance.
//!
//! Three things are worth knowing if the build complains:
//!
//!  - the engine is not `Send`, so it is created and used on the engine's
//!    own thread and never moves;
//!  - the graphics device and the window belong to that same thread, because
//!    a swap chain is bound to both;
//!  - the window is Win32 and hand-made, so the `windows` crate is only
//!    compiled on Windows — the module has a stub for everywhere else, and
//!    the floating mode reports that it needs Windows rather than failing
//!    to build.

pub mod b64;
pub mod engine;
pub mod log;
pub mod textures;
pub mod window;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use engine::{Command, EngineHandle, Frame, Mode, Semantics, Status};

/// one preset in the folder
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    /// the file's name, without the extension */
    pub name: String,
    /// the full path, which is what the engine loads */
    pub path: String,
}

/// the engine, and the last thing it said about itself
pub struct VisualizerState {
    handle: Mutex<Option<EngineHandle>>,
    status: Mutex<Status>,
}

impl Default for VisualizerState {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            status: Mutex::new(Status::default()),
        }
    }
}

impl VisualizerState {
    /// the engine, if it is running
    fn handle(&self) -> Option<EngineHandle> {
        self.handle.lock().ok().and_then(|h| h.clone())
    }
}

#[tauri::command]
pub fn visualizer_status(state: State<'_, VisualizerState>) -> Status {
    if let Some(handle) = state.handle() {
        if let Ok(status) = handle.status.lock() {
            let copy = status.clone();
            if let Ok(mut held) = state.status.lock() {
                *held = copy.clone();
            }
            return copy;
        }
    }
    state.status.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn visualizer_start(
    mode: String,
    width: u32,
    height: u32,
    sample_rate: u32,
    compat: String,
    state: State<'_, VisualizerState>,
) -> Result<(), String> {
    let Some(mode) = Mode::parse(&mode) else {
        return Err("that is not a way of showing the visualiser".into());
    };
    let Some(semantics) = Semantics::parse(&compat) else {
        return Err("that is not a set of semantics the engine knows".into());
    };
    /* one engine at a time: a second one would fight the first for the GPU,
       so the old one is told to stop before the new one starts */
    if let Ok(mut slot) = state.handle.lock() {
        if let Some(old) = slot.as_ref() {
            old.send(Command::Stop);
        }
        *slot = None;
    }
    let handle = engine::spawn(mode, width.max(64), height.max(64), sample_rate, semantics);
    if let Ok(mut slot) = state.handle.lock() {
        *slot = Some(handle);
    }
    Ok(())
}

#[tauri::command]
pub fn visualizer_stop(state: State<'_, VisualizerState>) {
    if let Some(handle) = state.handle() {
        handle.send(Command::Stop);
    }
    if let Ok(mut slot) = state.handle.lock() {
        *slot = None;
    }
    if let Ok(mut status) = state.status.lock() {
        status.running = false;
        status.mode = "off".into();
        status.preset = None;
    }
}

#[tauri::command]
pub fn visualizer_set_mode(
    mode: String,
    /* the channel is NOT optional: the toolkit only knows how to read a bare
       channel out of a request, so it is always there — in the window mode
       the engine simply never writes to it */
    frames: Channel<Frame>,
    state: State<'_, VisualizerState>,
) -> Result<(), String> {
    let Some(mode) = Mode::parse(&mode) else {
        return Err("that is not a way of showing the visualiser".into());
    };
    let Some(handle) = state.handle() else {
        return Err("the visualiser is not running".into());
    };
    handle.send(Command::SetMode(mode, Some(frames)));
    Ok(())
}

/// the samples, on their way to the engine
#[tauri::command]
pub fn visualizer_pcm(
    samples: String,
    channels: usize,
    state: State<'_, VisualizerState>,
) -> Result<(), String> {
    let Some(handle) = state.handle() else {
        return Ok(());
    };
    let bytes = b64::decode(&samples)?;
    handle.send(Command::Pcm(bytes, channels.max(1)));
    Ok(())
}

/// the presets in a folder — and the engine is told about them, so that the
/// stepper has something to step through
#[tauri::command]
pub fn visualizer_list_presets(
    dir: String,
    state: State<'_, VisualizerState>,
) -> Result<Vec<Preset>, String> {
    let path = PathBuf::from(dir.trim());
    let found = engine::scan_presets(&path);
    if let Some(handle) = state.handle() {
        handle.send(Command::SetPresets(found.clone()));
    }
    if let Ok(mut status) = state.status.lock() {
        status.preset_count = found.len() as u32;
    }
    Ok(found
        .iter()
        .map(|p| Preset {
            name: p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("preset")
                .to_string(),
            path: p.to_string_lossy().to_string(),
        })
        .collect())
}

#[tauri::command]
pub fn visualizer_load_preset(path: String, state: State<'_, VisualizerState>) -> Result<(), String> {
    let Some(handle) = state.handle() else {
        return Err("the visualiser is not running".into());
    };
    handle.send(Command::LoadPreset(path));
    Ok(())
}

#[tauri::command]
pub fn visualizer_preset_step(delta: i32, state: State<'_, VisualizerState>) -> Result<(), String> {
    let Some(handle) = state.handle() else {
        return Err("the visualiser is not running".into());
    };
    handle.send(Command::StepPreset(delta));
    Ok(())
}

#[tauri::command]
pub fn visualizer_set_texture_dir(
    dir: String,
    state: State<'_, VisualizerState>,
) -> Result<(), String> {
    let Some(handle) = state.handle() else {
        return Ok(());
    };
    handle.send(Command::SetTextureDir(dir));
    Ok(())
}

#[tauri::command]
pub fn visualizer_set_size(
    width: u32,
    height: u32,
    state: State<'_, VisualizerState>,
) -> Result<(), String> {
    let Some(handle) = state.handle() else {
        return Ok(());
    };
    handle.send(Command::SetSize(width, height));
    Ok(())
}

/// where the log is, so the panel can say so
#[tauri::command]
pub fn visualizer_log_path() -> String {
    log::path().to_string_lossy().to_string()
}
