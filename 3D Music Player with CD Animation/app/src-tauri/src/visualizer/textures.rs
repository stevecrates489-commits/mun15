//! The pictures a preset asks for.
//!
//! A preset's shaders sample textures by name — `sampler_clouds2` and so on.
//! The engine never touches the filesystem: it asks the host for the pixels
//! through this trait. The reference implementation of a directory-backed
//! provider lives in the upstream repository but is not published, so it is
//! written here.
//!
//! Two rules from the engine's contract are easy to get wrong:
//!
//!  - the names are lowercase and carry NO extension and NO `sampler_`
//!    prefix — `sampler_fw_clouds2` is asked for as `clouds2`;
//!  - the random pool must be sorted, because the order is part of the
//!    engine's determinism: the same preset must draw the same pictures on
//!    every run.

use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};

use lactea::{Image, TextureProvider};

/// the file extensions a preset's textures come in
const EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "tga", "webp"];

pub struct DirTextures {
    /// every texture the folders hold, by name — the random pool
    pool: Vec<String>,
    /// what has already been decoded, by name
    cache: Arc<Mutex<HashMap<String, Image>>>,
    /// set when the background thread has decoded the whole pool
    ready: Arc<AtomicBool>,
}

impl DirTextures {
    pub fn new(dirs: &[PathBuf]) -> Self {
        let mut names = BTreeSet::new();
        for dir in dirs {
            collect_names(dir, &mut names);
        }
        let pool: Vec<String> = names.into_iter().collect();
        let cache = Arc::new(Mutex::new(HashMap::new()));

        /* Decode the whole pool on a thread of its own, and NEVER on the
         * thread that draws.
         *
         * A preset that samples a RANDOM texture each frame asks for a
         * different name every so often, and the first time each one is seen
         * it has to be decoded. Doing that on the render thread costs tens
         * of milliseconds — a visible hitch every couple of seconds, for
         * as long as the pool takes to walk.
         *
         * Doing it here, in the background, costs nothing at the moment: the
         * engine asks for a texture that is not ready yet, gets a transparent
         * one for that frame, and the pool catches up behind it. The engine
         * is told to look again when the pool is done.
         *
         * And it is not done here either, synchronously: a folder of a few
         * hundred pictures takes seconds to decode, and doing that on the
         * engine's thread was a seven-second wait for the window. */
        let background = Arc::clone(&cache);
        let to_decode: Vec<String> = pool.clone();
        let folders = dirs.to_vec();
        let ready = Arc::new(AtomicBool::new(false));
        let finished = Arc::clone(&ready);
        let _ = std::thread::Builder::new()
            .name("visualiser-textures".into())
            .spawn(move || {
                for name in to_decode {
                    let Some(path) = find_in(&folders, &name) else {
                        continue;
                    };
                    let Ok(decoded) = image::open(&path) else {
                        continue;
                    };
                    let rgba = decoded.to_rgba8();
                    let (width, height) = (rgba.width(), rgba.height());
                    if let Ok(mut cache) = background.lock() {
                        cache.insert(
                            name.clone(),
                            Image {
                                width,
                                height,
                                rgba8: rgba.into_raw(),
                            },
                        );
                    }
                    let _ = &name;
                    /* Give the drawing thread room. A big picture is a lot of
                     * CPU, and the render thread needs it more than the
                     * folder does — decoding without a pause is what a
                     * background job that steals the machine looks like. */
                    std::thread::sleep(std::time::Duration::from_millis(12));
                }
                finished.store(true, std::sync::atomic::Ordering::SeqCst);
            });

        Self {
            pool,
            cache,
            ready,
        }
    }

    /// a handle to the readiness flag, so the owner can watch it
    pub fn ready_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.ready)
    }
}

/// the file behind a texture name, in the first folder that has it
fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    let wanted = name.to_ascii_lowercase();
    for dir in dirs {
        for ext in EXTENSIONS {
            let candidate = dir.join(format!("{wanted}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        /* a preset may name its texture with a folder of its own */
        let nested = dir.join(&wanted);
        if nested.is_dir() {
            for ext in EXTENSIONS {
                let candidate = nested.join(format!("{wanted}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn collect_names(dir: &Path, names: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_names(&path, names);
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
            names.insert(stem.to_ascii_lowercase());
        }
    }
}

impl TextureProvider for DirTextures {
    fn load(&mut self, name: &str) -> Option<Image> {
        /* A LOOKUP AND NOTHING ELSE.
         *
         * Decoding here would be decoding on the thread that draws, and a
         * PNG is tens of milliseconds. The background thread does the
         * decoding; if a texture is not ready yet the engine gets a
         * transparent one for that frame, and is told to look again when
         * the pool is done. A missing texture for a frame is invisible; a
         * decode on the render thread is a hitch you can see. */
        let key = name.to_ascii_lowercase();
        self.cache.lock().ok().and_then(|c| c.get(&key).cloned())
    }

    fn random_pool(&self) -> Vec<String> {
        self.pool.clone()
    }
}
