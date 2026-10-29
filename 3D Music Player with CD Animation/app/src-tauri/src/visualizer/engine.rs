//! The engine.
//!
//! The renderer is the real thing: the MilkDrop engine itself, running on
//! the GPU, with the presets' own shaders and their own expressions. This
//! module is the host it needs — a graphics device, a target to draw into,
//! and the samples to feed it.
//!
//! ── One thread, and why ────────────────────────────────────────────────
//!
//! The engine cannot be moved between threads (it holds a texture provider,
//! which is neither `Send` nor `Sync`), a swap chain belongs to the window
//! AND to the thread that created it, and a Win32 window's messages must be
//! pumped on the thread that made it. So the whole thing — window, device,
//! engine, render loop — lives on one dedicated thread, and the app talks to
//! it through a queue of commands.
//!
//! ── The two ways of showing it ─────────────────────────────────────────
//!
//!   WINDOW    the engine draws straight into the swap chain. Nothing
//!             crosses the process boundary; the pictures never leave the
//!             GPU.
//!
//!   BACKDROP  the visuals are the app's own background, so they have to
//!             come back across the boundary. The engine renders into an
//!             off-screen texture, reads it back and sends it over. That is
//!             slower and it costs a copy, which is why it runs smaller and
//!             slower than the window does.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lactea::{Compat, Engine, EngineConfig, FrameClock, Transition};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use super::b64;
use super::textures::DirTextures;
use super::window::VisualizerWindow;

const TARGET_FPS: u32 = 60;
const FRAME: Duration = Duration::from_nanos(1_000_000_000 / 60);
/// how many frames go by before the backdrop's picture is carried back to
/// the app: three frames is twenty pictures a second, which is plenty for
/// something behind a player and a third of the traffic
const BACKDROP_DIVISOR: u32 = 3;
/// how long the window has to stop moving before the picture is redrawn at
/// the new size — the engine clears its feedback image when it resizes,
/// so resizing mid-drag would wipe the picture over and over
const RESIZE_STEP: Duration = Duration::from_millis(100);
/// a frame longer than this is a stall, and is written to the log
const STALL_MS: f64 = 33.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Window,
    Wallpaper,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Window => "window",
            Mode::Wallpaper => "wallpaper",
        }
    }

    pub fn parse(text: &str) -> Option<Mode> {
        match text {
            "window" => Some(Mode::Window),
            "wallpaper" => Some(Mode::Wallpaper),
            _ => None,
        }
    }
}

/// one rendered picture, on its way back to the app
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// base64 of RGBA8, row 0 = the top row
    pub data: String,
}

pub enum Command {
    Stop,
    SetMode(Mode, Option<Channel<Frame>>),
    Pcm(Vec<u8>, usize),
    LoadPreset(String),
    StepPreset(i32),
    SetTextureDir(String),
    SetSize(u32, u32),
    SetPresets(Vec<PathBuf>),
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub mode: String,
    pub preset: Option<String>,
    pub compat: Option<String>,
    pub fps: u32,
    pub error: Option<String>,
    pub preset_count: u32,
    /// how long the CPU half of a frame takes, in milliseconds — the preset's
    /// per-vertex equations
    pub cpu_ms: f64,
    /// how long the wait for the GPU takes, in milliseconds — the pixels
    pub gpu_ms: f64,
    /// the size the picture is drawn at, which is not the size of the window:
    /// the picture is stretched into the window
    pub render_width: u32,
    pub render_height: u32,
    /// the size of the window the picture is stretched into
    pub window_width: u32,
    pub window_height: u32,
    /// which piece of hardware is actually drawing — the difference between
    /// "the visualiser is slow" and "the visualiser is on the CPU"
    pub adapter: Option<String>,
}

/// the handle the app holds
#[derive(Clone)]
pub struct EngineHandle {
    tx: SyncSender<Command>,
    /// set when the engine should stop, so that a stop is never lost to a
    /// full queue
    stop: Arc<AtomicBool>,
    pub status: Arc<Mutex<Status>>,
}

impl EngineHandle {
    pub fn send(&self, command: Command) {
        match command {
            Command::Stop => {
                /* the flag is the reliable signal: the queue may be full, and
                   a command thread must never block on a full queue */
                self.stop.store(true, Ordering::SeqCst);
                let _ = self.tx.try_send(Command::Stop);
            }
            other => {
                /* the queue is bounded: a slow engine must not have samples
                   pile up behind it, and a dropped block of samples costs
                   nothing — the next one arrives in a frame */
                let _ = self.tx.try_send(other);
            }
        }
    }
}

/// Which semantics the engine runs under.
///
/// The mode is fixed when the engine is made — the renderer is built around
/// it — so changing it means making a new engine. That is why this is a
/// start-time choice rather than a live switch.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Semantics {
    /// Let the engine decide, per preset.
    ///
    /// A MilkDrop 3 file carries evidence of what it needs, and the engine
    /// reads it and runs the preset under MilkDrop 3. Everything else runs
    /// under projectM's behaviour, which is the same as the original's for
    /// ordinary presets.
    ///
    /// This is the DEFAULT, and it matters: an MD3 preset forced to run
    /// under MD2 semantics does not merely look wrong, it can hang the
    /// engine outright.
    Auto,
    /// the original renderer's own behaviour: the "exact Winamp" look, and
    /// the per-vertex blend patterns that go with it
    MilkDrop2,
    /// MilkDrop 3: double presets, the MD3 blend patterns, the auto hard
    /// cuts and the composite-shader effects
    MilkDrop3,
    /// the reference implementation's behaviour
    ProjectM,
}

impl Semantics {
    pub fn parse(text: &str) -> Option<Semantics> {
        match text {
            "auto" => Some(Semantics::Auto),
            "milkdrop2" => Some(Semantics::MilkDrop2),
            "milkdrop3" => Some(Semantics::MilkDrop3),
            "projectm" => Some(Semantics::ProjectM),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Semantics::Auto => "auto",
            Semantics::MilkDrop2 => "milkdrop2",
            Semantics::MilkDrop3 => "milkdrop3",
            Semantics::ProjectM => "projectm",
        }
    }

    /// the mode the engine is told to use, and whether it may pick per preset
    fn to_lactea(self) -> (Compat, bool) {
        match self {
            /* the engine resolves MilkDrop 3 on its own, and falls back to
               projectM's behaviour for everything else */
            Semantics::Auto => (Compat::ProjectM, true),
            Semantics::MilkDrop2 => (Compat::MilkDrop2, false),
            Semantics::MilkDrop3 => (Compat::MilkDrop3, false),
            Semantics::ProjectM => (Compat::ProjectM, false),
        }
    }
}
/// Start the engine on its own thread.
pub fn spawn(
    mode: Mode,
    width: u32,
    height: u32,
    sample_rate: u32,
    semantics: Semantics,
) -> EngineHandle {
    let (tx, rx) = std::sync::mpsc::sync_channel::<Command>(1024);
    let stop = Arc::new(AtomicBool::new(false));
    let status = Arc::new(Mutex::new(Status {
        running: false,
        mode: mode.as_str().to_string(),
        ..Default::default()
    }));
    let thread_status = Arc::clone(&status);
    let thread_stop = Arc::clone(&stop);
    /* the thread needs the status too, and the handle below still wants it:
       so the thread takes a copy rather than the original */
    let thread_own_status = Arc::clone(&status);

    let spawned = std::thread::Builder::new()
        .name("visualiser".into())
        .spawn(move || {
            super::log::open();
            super::log::write(&format!(
                "the engine starts: mode {}, semantics {}, {}x{} at {}Hz",
                mode.as_str(),
                semantics.as_str(),
                width,
                height,
                sample_rate
            ));
            let worker = match Worker::new(mode, width, height, sample_rate, semantics, thread_own_status) {
                Ok(w) => w,
                Err(e) => {
                    if let Ok(mut s) = thread_status.lock() {
                        s.running = false;
                        s.error = Some(e);
                    }
                    return;
                }
            };
            worker.run(rx, thread_status, thread_stop);
        });

    if spawned.is_err() {
        if let Ok(mut s) = status.lock() {
            s.error = Some("the visualiser thread could not be started".into());
        }
    }

    EngineHandle { tx, stop, status }
}

/// the off-screen target used by the backdrop mode
struct Readback {
    texture: wgpu::Texture,
    buffer: wgpu::Buffer,
    bytes_per_row: u32,
    busy: Arc<AtomicBool>,
    out: Arc<Mutex<Option<Vec<u8>>>>,
}

struct Worker {
    /// kept so that a rebuilt surface comes from the SAME instance, and so
    /// from the same backend as the device
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    /// the format the engine draws in — the surface has to agree with it
    format: wgpu::TextureFormat,
    device: wgpu::Device,
    queue: wgpu::Queue,
    engine: Engine,
    mode: Mode,
    width: u32,
    height: u32,
    /// the window's own size — the picture is stretched into it
    window_width: u32,
    window_height: u32,
    /// the window is filling the monitor
    fullscreen: bool,
    /// when the picture was last redrawn at a new size
    last_resize: Option<Instant>,
    /// the window is shown only once there is a picture to show
    revealed: bool,
    frame: u32,
    started: Instant,
    window: Option<VisualizerWindow>,
    surface: Option<wgpu::Surface<'static>>,
    surface_config: Option<wgpu::SurfaceConfiguration>,
    readback: Option<Readback>,
    frame_channel: Option<Channel<Frame>>,
    presets: Vec<PathBuf>,
    current: Option<usize>,
    texture_dirs: Vec<PathBuf>,
    fps: u32,
    /// the two halves of a frame, in milliseconds
    cpu_ms: f64,
    gpu_ms: f64,
    /// the smoothed cost of a whole frame
    frame_ms: f64,
    /// how many frames have run long
    stalls: u32,
    fps_count: u32,
    fps_since: Instant,
    /// the set of semantics the engine was made with
    semantics: Semantics,
    /// the flag the background thread sets when the texture pool is decoded
    texture_ready: Option<Arc<AtomicBool>>,
    /// whether that has happened yet
    textures_ready: bool,
    /// the engine's own account of itself, shared with the app
    status: Arc<Mutex<Status>>,
}

impl Worker {
    fn new(
        mode: Mode,
        width: u32,
        height: u32,
        sample_rate: u32,
        semantics: Semantics,
        status: Arc<Mutex<Status>>,
    ) -> Result<Self, String> {
        let instance = new_instance();

        /* the surface has to exist before the adapter is asked for: the
           adapter must be one that can present to it */
        let (surface, window) = if mode == Mode::Window {
            let window = VisualizerWindow::new(width, height)?;
            let surface = unsafe { create_surface(&instance, window.raw_handle())? };
            (Some(surface), Some(window))
        } else {
            (None, None)
        };

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: surface.as_ref(),
            apply_limit_buckets: false,
        }))
        .map_err(|e| e.to_string())?;

        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: None,
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::default(),
            memory_hints: wgpu::MemoryHints::default(),
            trace: wgpu::Trace::Off,
        }))
        .map_err(|e| e.to_string())?;

        /* which hardware is doing the drawing. A software adapter shows up
           here as a driver name nobody recognises ("llvmpipe",
           "Microsoft Basic Render Driver"), and it is the difference
           between "this preset is heavy" and "this is not a GPU at all". */
        let info = adapter.get_info();
        let adapter_name = Some(format!(
            "{} · {:?} · {}",
            info.name, info.backend, info.driver
        ));
        /* WHICH HARDWARE IS DRAWING — the difference between "this preset is
           heavy" and "this is not a GPU at all" */
        super::log::write(&format!("the adapter is {}", adapter_name.clone().unwrap_or_default()));
        if let Ok(mut s) = status.lock() {
            s.adapter = adapter_name.clone();
        }

        let format = match surface.as_ref() {
            Some(s) => {
                let caps = s.get_capabilities(&adapter);
                caps.formats
                    .first()
                    .copied()
                    .unwrap_or(wgpu::TextureFormat::Bgra8Unorm)
            }
            None => wgpu::TextureFormat::Rgba8Unorm,
        };

        let (compat, auto_compat) = semantics.to_lactea();
        let config = EngineConfig {
            width,
            height,
            /* the semantics the listener asked for: the original renderer's
               own behaviour by default, which is the whole reason for
               choosing this engine */
            compat,
            /* with this on, the engine reads each preset and runs it under
               the semantics it was written for */
            auto_compat,
            output_format: format,
            fps: TARGET_FPS,
            /* the rate the audio really runs at: a webview usually uses
               48kHz, and the engine's own default is 44.1kHz — analysing at
               the wrong rate makes every beat land in the wrong place */
            sample_rate: if sample_rate > 0 { sample_rate } else { 44_100 },
            /* The mesh is the CPU half of a frame: every vertex is
             * evaluated by the preset's own expressions, every frame.
             *
             * The log is unambiguous about it — a MilkDrop 3 preset on this
             * machine was spending 57ms a frame in the equations, and the
             * original renderer's windowed default (32x24) was still too
             * fine for it. Sixteen by twelve is four times less work, and the
             * difference between 57ms and 14ms is the difference between nine
             * frames a second and sixty. */
            mesh: [16, 12],
            ..Default::default()
        };

        let mut engine = Engine::new(&device, &queue, config).map_err(|e| e.to_string())?;
        engine.set_texture_provider(Box::new(DirTextures::new(&[])));

        let mut surface_config = None;
        if let Some(s) = surface.as_ref() {
            let caps = s.get_capabilities(&adapter);
            let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::AutoVsync) {
                wgpu::PresentMode::AutoVsync
            } else {
                caps.present_modes
                    .first()
                    .copied()
                    .unwrap_or(wgpu::PresentMode::Fifo)
            };
            let alpha_mode = caps
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto);
            let cfg = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                color_space: wgpu::SurfaceColorSpace::Auto,
                width,
                height,
                present_mode,
                alpha_mode,
                view_formats: vec![],
                desired_maximum_frame_latency: 2,
            };
            s.configure(&device, &cfg);
            surface_config = Some(cfg);
        }

        let now = Instant::now();
        Ok(Worker {
            instance,
            adapter,
            format,
            device,
            queue,
            engine,
            mode,
            width,
            height,
            window_width: width,
            window_height: height,
            fullscreen: false,
            last_resize: None,
            revealed: false,
            frame: 0,
            started: now,
            window,
            surface,
            surface_config,
            readback: None,
            frame_channel: None,
            presets: Vec::new(),
            current: None,
            texture_dirs: Vec::new(),
            fps: 0,
            cpu_ms: 0.0,
            gpu_ms: 0.0,
            frame_ms: 0.0,
            stalls: 0,
            fps_count: 0,
            fps_since: now,
            status,
            semantics,
            texture_ready: None,
            textures_ready: false,
        })
    }

    fn run(
        mut self,
        commands: Receiver<Command>,
        status: Arc<Mutex<Status>>,
        stop: Arc<AtomicBool>,
    ) {
        if let Ok(mut s) = status.lock() {
            s.running = true;
            s.error = None;
            s.compat = Some(
                match self.engine.current_compat() {
                    Compat::MilkDrop2 => "milkdrop2",
                    Compat::MilkDrop3 => "milkdrop3",
                    Compat::ProjectM => "projectm",
                }
                .to_string(),
            );
        }

        let mut next = Instant::now();
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }

            /* the window's messages are pumped here, because this is the
               thread that made it */
            if let Some(w) = self.window.as_ref() {
                w.pump();
            }

            let mut stop_now = false;
            while let Ok(command) = commands.try_recv() {
                if self.handle(command) {
                    stop_now = true;
                    break;
                }
            }
            if stop_now {
                break;
            }

            self.render();
            self.frame = self.frame.wrapping_add(1);

            /* the frame rate, measured over a second */
            self.fps_count += 1;
            if self.fps_since.elapsed() >= Duration::from_secs(1) {
                self.fps = self.fps_count;
                self.fps_count = 0;
                self.fps_since = Instant::now();
                if let Ok(mut s) = status.lock() {
                    s.fps = self.fps;
                    s.cpu_ms = self.cpu_ms;
                    s.gpu_ms = self.gpu_ms;
                    s.render_width = self.width;
                    s.render_height = self.height;
                }
                /* a line a second, so the log reads as a timeline rather
                   than a list of surprises */
                super::log::write(&format!(
                    "fps {} | frame {:.1}ms | cpu {:.1}ms | gpu {:.1}ms | {}x{} | mesh {:?} | stalls {}",
                    self.fps,
                    self.frame_ms,
                    self.cpu_ms,
                    self.gpu_ms,
                    self.width,
                    self.height,
                    self.engine.mesh_size(),
                    self.stalls
                ));
            }

            next += FRAME;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                /* the frame took longer than the frame is: do not try to
                   catch up, just carry on from here */
                next = now;
            }
        }

        if let Some(w) = self.window.as_ref() {
            w.destroy();
        }
        if let Ok(mut s) = status.lock() {
            s.running = false;
        }
    }

    /// returns true when the engine should stop
    fn handle(&mut self, command: Command) -> bool {
        match command {
            Command::Stop => return true,
            Command::SetMode(mode, channel) => {
                self.set_mode(mode, channel);
            }
            Command::Pcm(bytes, channels) => {
                let samples: Vec<i16> = bytes
                    .chunks_exact(2)
                    .map(|c| i16::from_le_bytes([c[0], c[1]]))
                    .collect();
                if !samples.is_empty() {
                    self.engine.push_pcm_i16(&samples, channels);
                }
            }
            Command::LoadPreset(path) => {
                self.load_preset(&path);
            }
            Command::StepPreset(delta) => {
                self.step_preset(delta);
            }
            Command::SetTextureDir(dir) => {
                self.texture_dirs = if dir.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![PathBuf::from(dir.trim())]
                };
                let provider = DirTextures::new(&self.texture_dirs);
                self.texture_ready = Some(provider.ready_flag());
                self.engine.set_texture_provider(Box::new(provider));
                /* the pictures a preset uses are resolved when it loads, so
                   it has to be loaded again to see the new folder */
                if let Some(current) = self.current {
                    let path = self.presets[current].clone();
                    self.load_preset(&path.to_string_lossy());
                }
            }            Command::SetSize(width, height) => {
                self.set_size(width, height);
            }
            Command::SetPresets(paths) => {
                self.presets = paths;
                if self.current.is_none() {
                    if let Some(first) = self.presets.first().cloned() {
                        self.current = Some(0);
                        self.load_preset(&first.to_string_lossy());
                    }
                }
            }
        }
        false
    }

    fn set_mode(&mut self, mode: Mode, channel: Option<Channel<Frame>>) {
        if mode == self.mode && channel.is_none() {
            return;
        }
        self.mode = mode;
        self.frame_channel = channel;

        match mode {
            Mode::Window => {
                /* the off-screen target is no longer wanted */
                self.readback = None;
                if self.window.is_none() {
                    if let Ok(window) = VisualizerWindow::new(self.width, self.height) {
                        self.window = Some(window);
                    }
                }
                if let Some(window) = self.window.as_ref() {
                    window.show();
                }
                /* the surface is only built when there is not one already:
                   throwing a working one away to make another is how a
                   visualiser ends up showing nothing */
                if self.window.is_some() && self.surface.is_none() {
                    self.rebuild_surface();
                }
            }
            Mode::Wallpaper => {
                if let Some(window) = self.window.as_ref() {
                    window.hide();
                }
                self.readback = Some(self.make_readback(self.width, self.height));
            }
        }
    }

    fn rebuild_surface(&mut self) {
        let Some(window) = self.window.as_ref() else {
            return;
        };
        /* the SAME instance and adapter as the device: a surface from
           another backend cannot be presented by this device */
        let Ok(surface) = (unsafe { create_surface(&self.instance, window.raw_handle()) }) else {
            return;
        };
        let caps = surface.get_capabilities(&self.adapter);
        /* the engine draws in one format, so the surface has to offer it */
        let format = if caps.formats.contains(&self.format) {
            self.format
        } else {
            caps.formats
                .first()
                .copied()
                .unwrap_or(self.format)
        };
        let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::AutoVsync) {
            wgpu::PresentMode::AutoVsync
        } else {
            caps.present_modes
                .first()
                .copied()
                .unwrap_or(wgpu::PresentMode::Fifo)
        };
        let alpha_mode = caps
            .alpha_modes
            .first()
            .copied()
            .unwrap_or(wgpu::CompositeAlphaMode::Auto);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: self.width,
            height: self.height,
            present_mode,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&self.device, &config);
        self.surface = Some(surface);
        self.surface_config = Some(config);
        /* the engine's own size follows the window's */
        let _ = self.engine.resize(self.width, self.height);
    }

    fn set_size(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.width = width;
        self.height = height;
        let _ = self.engine.resize(width, height);
        if let Some(window) = self.window.as_ref() {
            /* where the window already is, so that resizing it does not
               throw it back into the corner */
            let (x, y) = window.position().unwrap_or((0, 0));
            window.place(x, y, width, height);
        }
        if let Some(config) = self.surface_config.as_mut() {
            config.width = width;
            config.height = height;
            if let Some(surface) = self.surface.as_ref() {
                surface.configure(&self.device, config);
            }
        }
        if self.mode == Mode::Wallpaper {
            self.readback = Some(self.make_readback(width, height));
        }
    }

    fn make_readback(&self, width: u32, height: u32) -> Readback {
        /* a copy's rows are aligned to 256 bytes, so the read-back buffer is
           wider than the picture and the padding is stripped on the way out */
        let bytes_per_row = (width * 4).div_ceil(256) * 256;
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("visualiser"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("visualiser-readback"),
            size: (bytes_per_row as u64) * (height as u64),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        Readback {
            texture,
            buffer,
            bytes_per_row,
            busy: Arc::new(AtomicBool::new(false)),
            out: Arc::new(Mutex::new(None)),
        }
    }

    fn load_preset(&mut self, path: &str) {
        let started = Instant::now();
        let file = Path::new(path);
        let Ok(bytes) = std::fs::read(file) else {
            return;
        };
        let name = file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("preset")
            .to_string();
        /* a soft cut blends the old picture into the new one, which is what
           the original did when the listener changed track */
        match self.engine.load_preset(&bytes, &name, Transition::Cut) {
            Ok(_) => {
                super::log::write(&format!(
                    "preset {:?} loaded in {:.0}ms",
                    name,
                    started.elapsed().as_secs_f64() * 1000.0
                ));
                if let Some(index) = self.presets.iter().position(|p| p == file) {
                    self.current = Some(index);
                }
                if let Ok(mut status) = self.status.lock() {
                    status.preset = Some(name);
                    status.error = None;
                }
            }
            Err(err) => {
                let detail: String = err.to_string();
                let detail: String = detail.chars().take(160).collect();
                super::log::write(&format!(
                    "preset {:?} REFUSED in {:.0}ms: {}",
                    name,
                    started.elapsed().as_secs_f64() * 1000.0,
                    detail
                ));
                /* A preset that will not load is usually a preset for a
                   different set of semantics — a MilkDrop 3 file under the
                   MilkDrop 2 renderer, for one. Saying so is the difference
                   between "it is broken" and "try the other one". */
                if let Ok(mut status) = self.status.lock() {
                    status.error = Some(format!(
                        "{} would not load under {} — {}. Try another set of semantics.",
                        name,
                        self.semantics.as_str(),
                        detail
                    ));
                }
            }
        }
    }

    fn step_preset(&mut self, delta: i32) {
        if self.presets.is_empty() {
            return;
        }
        let len = self.presets.len() as i32;
        let current = self.current.unwrap_or(0) as i32;
        let next = ((current + delta) % len + len) % len;
        self.current = Some(next as usize);
        let path = self.presets[next as usize].clone();
        self.load_preset(&path.to_string_lossy());
    }

    fn time(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    fn render(&mut self) {
        /* The texture pool is decoded in the background. When it is done the
           engine is told to resolve the pictures again — the ones it could
           not find the first time are there now, and it has been drawing
           them as blank. */
        if let Some(flag) = self.texture_ready.as_ref() {
            if !self.textures_ready && flag.load(Ordering::SeqCst) {
                self.textures_ready = true;
                super::log::write("the texture pool is decoded — resolving the pictures again");
                self.engine.reload_textures();
            }
        }
        /* the window can be moved and resized by the listener, so its size
           is checked every frame: the engine and the surface have to follow
           it, or the picture is stretched into the wrong shape */
        if self.mode == Mode::Window {
            self.follow_window();
        }
        let started = Instant::now();
        match self.mode {
            Mode::Window => self.render_window(),
            Mode::Wallpaper => self.render_wallpaper(),
        }
        /* The window is shown only once there is a picture in it. A window
           that appears empty and then fills in looks broken; a window that
           never appears looks worse. */
        if !self.revealed && self.mode == Mode::Window {
            if let Some(window) = self.window.as_ref() {
                window.reveal();
                self.revealed = true;
            }
        }
        /* and it follows the eye to another desk */
        if self.mode == Mode::Window {
            if let Some(window) = self.window.as_ref() {
                window.follow_eye();
            }
        }
        /* WHAT THE LOG IS FOR: a stutter is a frame that took far longer than
           it should have. Whether it was the CPU half or the GPU half tells
           us what to go and look at, which is the whole difference between
           hunting and knowing. */
        let total = started.elapsed().as_secs_f64() * 1000.0;
        self.frame_ms = self.frame_ms * 0.9 + total * 0.1;
        if total > STALL_MS {
            self.stalls += 1;
            super::log::write(&format!(
                "STALL frame {}: {:.1}ms (cpu {:.1}ms, gpu {:.1}ms) — {} stalls so far",
                self.frame,
                total,
                self.cpu_ms,
                self.gpu_ms,
                self.stalls
            ));
        }
    }

    /// The size of the picture, in lines and pixels.
    ///
    /// The display's own size — the highest there is. The picture keeps the
    /// window's proportions and is scaled to fit it, so a small window still
    /// shows a picture of the display's full quality, just smaller. It is
    /// never bigger than the display, because pixels past the screen's edge
    /// are pixels nobody ever sees.
    fn picture_size(&self, aspect: f32) -> (u32, u32) {
        let (screen_w, screen_h) = self
            .window
            .as_ref()
            .and_then(|w| w.monitor_size())
            .filter(|(w, h)| *w > 0 && *h > 0)
            .unwrap_or((1920, 1080));
        let screen_w = screen_w as u32;
        let screen_h = screen_h as u32;
        let mut height = screen_h.min(2160);
        let mut width = (height as f32 * aspect).round() as u32;
        /* too wide for the screen? shrink both, keeping the proportions */
        if width > screen_w {
            width = screen_w;
            height = ((screen_w as f32 / aspect).round() as u32).max(16);
        }
        (width.max(16), height.max(16))
    }

    /// pick up a change in the window's size
    ///
    /// THE PICTURE AND THE WINDOW ARE TWO DIFFERENT THINGS, and keeping them
    /// apart is the whole point: the picture is drawn at a fixed QUALITY and
    /// the window shows it scaled to fit. So a small window shows a 1080p
    /// picture scaled down — sharp, just smaller — and a big one shows the
    /// same picture scaled up. The window's own size never touches the
    /// render target, which is why dragging it costs nothing.
    ///
    /// Only the window's SHAPE matters, because the picture keeps the
    /// window's proportions: a different shape means a different picture, and
    /// that is a resize — which clears the engine's feedback image, so it is
    /// left to settle first.
    fn follow_window(&mut self) {
        /* a double-click on the picture goes full screen, the way the
           original renderer did it */
        if super::window::take_fullscreen_request() {
            self.fullscreen = !self.fullscreen;
            if let Some(window) = self.window.as_mut() {
                window.remember_size(self.width, self.height);
                window.set_fullscreen(self.fullscreen);
            }
            self.last_resize = None;
        }
        let Some(window) = self.window.as_ref() else {
            return;
        };
        let Some((w, h)) = window.client_size() else {
            return;
        };
        if w == 0 || h == 0 {
            return;
        }
        self.window_width = w;
        self.window_height = h;

        /* the picture takes the window's proportions, at the display's own
           size: as many lines as the screen has, however wide that makes
           it */
        let aspect = w as f32 / h as f32;
        let (picture_w, picture_h) = self.picture_size(aspect);
        if picture_w == self.width && picture_h == self.height {
            self.last_resize = None;
            return;
        }

        /* Resize at most every RESIZE_STEP.
         *
         * The picture has to FOLLOW the window while it is being dragged —
         * a resize that only lands when the drag stops looks broken, because
         * the window changes and the picture does not. But the engine's
         * resize clears its feedback image, so doing it on every frame of a
         * drag would wipe the picture over and over. Ten times a second is
         * often enough to look live and rare enough not to flicker. */
        let now = Instant::now();
        if let Some(at) = self.last_resize {
            if now.duration_since(at) < RESIZE_STEP {
                return;
            }
        }
        self.last_resize = Some(now);

        self.width = picture_w;
        self.height = picture_h;
        let _ = self.engine.resize(picture_w, picture_h);
        if let Some(config) = self.surface_config.as_mut() {
            config.width = picture_w;
            config.height = picture_h;
            if let Some(surface) = self.surface.as_ref() {
                surface.configure(&self.device, config);
            }
        }
    }

    fn render_window(&mut self) {
        let Some(surface) = self.surface.as_ref() else {
            return;
        };
        let Some(config) = self.surface_config.as_ref() else {
            return;
        };
        let frame = surface.get_current_texture();
        let surface_texture = match frame {
            wgpu::CurrentSurfaceTexture::Success(t) => t,
            wgpu::CurrentSurfaceTexture::Suboptimal(t) => {
                surface.configure(&self.device, config);
                t
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                surface.configure(&self.device, config);
                return;
            }
            /* occluded, timed out, lost or invalid: the frame is skipped and
               the next one tries again */
            _ => return,
        };

        let view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        /* Two clocks, because the two halves of a frame are bottlenecks in
           different ways: the CPU records the commands (the preset's
           per-vertex equations), and the present waits for the GPU. Knowing
           which one is slow is the difference between turning the mesh down
           and turning the resolution down. */
        let cpu_start = Instant::now();
        self.engine.render(
            &mut encoder,
            &view,
            FrameClock {
                time: self.time(),
                frame: self.frame,
            },
        );
        let cpu_ms = cpu_start.elapsed().as_secs_f64() * 1000.0;
        self.queue.submit(Some(encoder.finish()));
        let gpu_start = Instant::now();
        self.queue.present(surface_texture);
        let gpu_ms = gpu_start.elapsed().as_secs_f64() * 1000.0;
        self.cpu_ms = self.cpu_ms * 0.9 + cpu_ms * 0.1;
        self.gpu_ms = self.gpu_ms * 0.9 + gpu_ms * 0.1;
    }

    fn render_wallpaper(&mut self) {
        let Some(rb) = self.readback.as_ref() else {
            return;
        };
        let view = rb
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        self.engine.render(
            &mut encoder,
            &view,
            FrameClock {
                time: self.time(),
                frame: self.frame,
            },
        );

        /* The read-back is the expensive half: it copies the picture off the
           GPU, waits for it, and then hands it to the app as text. The
           pictures do not need to cross that boundary at the display's rate
           — a background wants to be alive, not to be the foreground — so
           only every third frame is carried back. */
        if self.frame % BACKDROP_DIVISOR != 0 {
            self.queue.submit(Some(encoder.finish()));
            return;
        }

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &rb.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &rb.buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(rb.bytes_per_row),
                    rows_per_image: Some(self.height),
                },
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(encoder.finish()));

        /* ask for the pixels, then wait for them */
        if !rb.busy.swap(true, Ordering::SeqCst) {
            let buffer = rb.buffer.clone();
            /* the callback needs the buffer too, and it outlives the call —
               so it gets its own copy rather than the borrowed one */
            let owned = buffer.clone();
            let out = Arc::clone(&rb.out);
            let busy = Arc::clone(&rb.busy);
            buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
                if result.is_ok() {
                    /* the mapping is a RESULT in this version of the driver
                       API: a failed map is not a reason to give up on the
                       frame, only to leave the buffer alone */
                    if let Ok(mapped) = owned.slice(..).get_mapped_range() {
                        let mut bytes = vec![0u8; mapped.len()];
                        bytes.copy_from_slice(&mapped);
                        drop(mapped);
                        owned.unmap();
                        if let Ok(mut guard) = out.lock() {
                            *guard = Some(bytes);
                        }
                    }
                }
                busy.store(false, Ordering::SeqCst);
            });
        }
        /* wait for the copy to land and the mapping to be filled */
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());

        /* and hand them to the app */
        let ready = rb.out.lock().ok().and_then(|mut g| g.take());
        let Some(raw) = ready else {
            return;
        };
        let tight = if rb.bytes_per_row == self.width * 4 {
            raw
        } else {
            /* the rows were padded for the copy — take the padding off */
            let mut out = Vec::with_capacity((self.width * 4 * self.height) as usize);
            for row in 0..self.height {
                let start = (row * rb.bytes_per_row) as usize;
                let end = start + (self.width * 4) as usize;
                if end <= raw.len() {
                    out.extend_from_slice(&raw[start..end]);
                }
            }
            out
        };
        if let Some(channel) = self.frame_channel.as_ref() {
            let _ = channel.send(Frame {
                width: self.width,
                height: self.height,
                data: b64::encode(&tight),
            });
        }
    }
}

/// the presets in a folder — the `.milk` files, in a stable order
pub fn scan_presets(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if ext == "milk" || ext == "milk2" {
            out.push(path);
        }
    }
    out.sort();
    out
}

/// a surface for a window we already own
unsafe fn create_surface(
    instance: &wgpu::Instance,
    handle: Option<wgpu::rwh::RawWindowHandle>,
) -> Result<wgpu::Surface<'static>, String> {
    let handle = handle.ok_or("the window had no handle")?;
    /* The driver insists on a display handle before it will make a surface.
       The instance carries one too, and the two have to be the SAME handle
       or the driver refuses the surface — so both are made the same way,
       from the same empty Windows display. */
    let display = wgpu::rwh::RawDisplayHandle::Windows(wgpu::rwh::WindowsDisplayHandle::new());
    instance
        .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
            raw_display_handle: Some(display),
            raw_window_handle: handle,
        })
        .map_err(|e| e.to_string())
}

/// The display the visualiser's window is on.
///
/// Windows has one kind of display and the handle carries no data of its
/// own — it exists so the graphics driver can answer "which display is
/// this". The driver insists on having one before it will make a surface,
/// which is what this is for.
#[derive(Debug)]
pub struct WindowsDisplay;

impl wgpu::rwh::HasDisplayHandle for WindowsDisplay {
    fn display_handle(&self) -> Result<wgpu::rwh::DisplayHandle<'_>, wgpu::rwh::HandleError> {
        Ok(wgpu::rwh::DisplayHandle::windows())
    }
}

/// the graphics instance, with the display it belongs to
fn new_instance() -> wgpu::Instance {
    let mut desc =
        wgpu::InstanceDescriptor::new_with_display_handle(Box::new(WindowsDisplay));
    /* ONLY the native Windows backend.
     *
     * The default order is Vulkan first, and on a Windows machine with no
     * Vulkan driver that probe takes ten seconds to time out — and with a
     * software Vulkan driver installed (Mesa's lavapipe) it SUCCEEDS, and
     * then every frame is drawn on the CPU: nine frames a second, with the
     * cores so busy that the audio thread starves and the music goes
     * silent. DX12 is on every Windows 10 and later, and it is the
     * hardware path. */
    #[cfg(target_os = "windows")]
    {
        desc.backends = wgpu::Backends::DX12;
    }
    wgpu::Instance::new(desc)
}
