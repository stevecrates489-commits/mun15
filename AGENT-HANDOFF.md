# AGENT HANDOFF — MUN15H

Read this before touching anything. It is the current working map of the repo:
what the project is, how to run and verify it, where the systems live, what the
last big round changed, and what is still open. If this file and the code
disagree, the code wins — then fix this file.

Last rewritten: 2026-11-11, after the UI/UX overhaul round, the bug-fix pass,
the Cylinder Carousel integration, and the Sonic Topography visualizer ports.

---

## 0. GOLDEN RULES

- **Repo root is `aim project`.** The player lives in
  `3D Music Player with CD Animation/app/`. Run front-end commands there.
- **The shell is Git Bash** (not PowerShell). POSIX syntax, `head`/`tail`/`grep`/`rm`
  all work. An older version of this file wrongly claimed PowerShell; ignore it.
- **There is ONE layout edit mode** (`editChrome` / `isEditingLayout` in Home).
  It makes every button, header control and popover draggable, and gives the
  five stage panels drag + resize handles. `SAVE LAYOUT` is the only way out.
- **The queue/playlists panel replaced the tracklist + drawer.** The old
  `PlaylistPanel` is still mounted but hidden as a rollback path; the old
  `PlaylistDrawer` file remains but is no longer imported. Do not delete
  either without the user asking.
- **Never route the audio element through WebAudio.** The engine captures a
  stream from it; see `useAudioEngine.ts` before changing anything audio.
- **Everything since `HEAD` is uncommitted** and the working tree is huge.
  Commit only when the user asks, in themed batches.
- **The user verifies visually on their own machine.** Their screenshot/repro
  beats any theory. Keep layout, tokens and behaviour intact unless asked.
- **Run the gates after changes**: `tsc`, targeted `eslint`, `npm run test:unit`,
  and (for UI work) the relevant Playwright harness.

---

## 1. WHAT THIS PROJECT IS

**MUN15H MiniDisc Player** — a desktop music player styled as a luxury MiniDisc
deck. Tauri 2 shell + React 19 + TypeScript + Vite 7 + Tailwind 3, with a
vendored Python app (`dannify/`) serving the online side in its own window.

```
aim project/                          ← git root, branch main
├── AGENT-HANDOFF.md                  ← this file
├── README.md                         ← feature map (partly stale: tracklist → queue panel)
├── .agents/skills/                   ← design skills (unslop, liquid-glass, glisse, lenis, …)
├── graft/                            ← regenerable repo graph (gitignored; `graft build`)
├── .verify/                          ← root-level provider/chain probes (chainprobe, providerprobe, …)
└── 3D Music Player with CD Animation/
    ├── app/                          ← the player (npm/Vite/Tauri)
    │   ├── src/
    │   │   ├── main.tsx, App.tsx
    │   │   ├── pages/Home.tsx        ← THE orchestrator (~3150 lines; everything hangs off it)
    │   │   ├── hooks/useAudioEngine.ts ← audio engine (element lifecycle, standby, crossfade, AGC)
    │   │   ├── components/           ← QueuePanel, MusicControlPanel, PlayerSettingsPanel,
    │   │   │                            LayoutFrame, DraggableSurface, CustomizePanel, LyricsPanel,
    │   │   │                            DiscCase, ChromeVisualizer, CylinderCarousel, panels, ui/
    │   │   ├── features/
    │   │   │   ├── layout/           ← useLayoutBox, LayoutFrame helpers, chrome drag/offset store
    │   │   │   ├── lyrics/           ← provider chain, registry, order, install, ProviderList
    │   │   │   ├── playlist/         ← usePlaylist (library), usePlaylists (folders/system lists)
    │   │   │   ├── radio/            ← useRadio, songClock, radioLyrics
    │   │   │   ├── visualizer/       ← native MilkDrop engine bridge (useVisualizer, frames, pcm)
    │   │   │   ├── voltviz/          ← JS backdrop visualizers (BarGraph, Butterchurn, …)
    │   │   │   ├── dannify/          ← ONLINE extension bridge + downloads sync
    │   │   │   ├── disc/, wallpaper/, sources/
    │   │   ├── lib/                  ← library.ts (IndexedDB), keepAlive, radioTap, liquidGlass,
    │   │   │                            accent, color, icy, bootGate, safeMode, ttml, …
    │   │   └── types/
    │   ├── src-tauri/                ← Rust shell: sources registry, MilkDrop engine, dannify, lyrics HTTP
    │   ├── tests/                    ← plain-node unit tests (5 files)
    │   ├── docs/                     ← INTEGRATION_CONTRACT, ONLINE_SOURCES, ONLINE_SECTION,
    │   │                                YOUTUBE_PIPELINE, EXTENSION_SPEC (new, untracked)
    │   ├── .verify/                  ← extra scratch harnesses/shots (mostly untracked)
    │   └── nextprev-*.png, queuefix-*.png ← scratch screenshots, candidates for cleanup
    ├── dannify/                      ← vendored Dannify (Python) + player_bridge.py
    └── .verify/                      ← Playwright harness inventory (some new ones untracked)
```

**Docs worth reading before deep work:** `app/docs/EXTENSION_SPEC.md` (extension
contract), `app/docs/INTEGRATION_CONTRACT.md` (Dannify seam),
`app/docs/ONLINE_SOURCES.md` and `ONLINE_SECTION.md` (online providers),
`app/docs/YOUTUBE_PIPELINE.md`. The root `README.md` feature map still describes
the old tracklist; the queue panel is the current truth.

**Git:** branch `main`, HEAD `6eeeee2` (“pause-resume keep-alive, pointer-drag
reorder, 11-item UI/logic batch”). Every current change is uncommitted. The
`.gitignore` covers `node_modules/`, `dist/`, `src-tauri/target/`, `.venv/`,
`dannify/data/`, `dannify/bin/`, `graft/`, `.verify` images and `shots/`.

---

## 2. ENVIRONMENT AND COMMANDS

The session shell is **Git Bash**. Tools default to a cwd outside the project,
so always `cd` explicitly.

```bash
# repo root
cd "/c/Users/aryan/Documents/aim project"

# the player
cd "3D Music Player with CD Animation/app"

node_modules/.bin/tsc -b --pretty false          # type-check (must exit 0)
node_modules/.bin/eslint <touched files>         # lint only what you changed
npm run test:unit                                # 5 plain-node test files
node_modules/.bin/vite build                     # production build
npx vite --port 5210 --strictPort                # dev server for harnesses
```

- Node is v26; `.mts` tests run type-stripped directly.
- `npm run build` = `tsc -b && vite build`.
- Rust (only when touching `src-tauri/`):
  ```bash
  cd "3D Music Player with CD Animation/app/src-tauri"
  cargo check
  cargo test --lib the_shell_can_reach_every_provider -- --ignored   # live lyric endpoints
  ```
- Python (only after `dannify/player_bridge.py`):
  `./dannify/.venv/Scripts/python.exe -m py_compile dannify/player_bridge.py`
- `graft` is a Windows npm global on PATH; run it from the repo root
  (`graft map`, `graft ask "…" --source`). Rebuild with `graft build` after big
  changes.

### Playwright harness recipe

Harnesses live in `3D Music Player with CD Animation/.verify/*.mjs` and use
`playwright-core` with `chromium.launch({ channel: 'msedge', headless: true })`
(no bundled browsers on this machine). The Tauri shim is required before load:

```js
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {}, resources: {},
  }
})
```

Traps proven the hard way:

- `waitUntil: 'networkidle'` hangs on a cold Vite (HMR socket). Use
  `{ waitUntil: 'commit' }` or `'domcontentloaded'` plus a wait.
- **The boot intro `#boot` (z-index 99999) can stay up under the shim** and it
  swallows the first real pointer event. Do not rely on clicking it away —
  after load, `await page.evaluate(() => document.querySelector('#boot')?.remove())`
  (or poll for `#boot.gone`). Synthetic dispatches bypass it and give false confidence.
- `.mjs` files are plain JS: no TS casts/annotations, including inside
  `page.evaluate` callbacks.
- Import a TS module inside `page.evaluate` with `await import('/src/...')`
  (Vite serves transformed TS) — but JSX/`.tsx` only from the app page, not a
  blank one. `.verify/mount.tsx` exists for that; `vite.config.ts` sets
  `server.fs.allow: ['..']`.
- Import test audio by generating small WAV Buffers and `setInputFiles` on the
  hidden `input[type=file][accept*=".mp3"]` in Home.
- Headless audio stays STANDBY (no real `audio.src`); you can test selection,
  state and UI, not audible playback.
- Log results incrementally and end with `process.exit(0)` — `browser.close()`
  can hang.
- Always stop a dev server you started (`netstat`/`Get-NetTCPConnection`, then
  kill by PID).

---

## 3. VERIFICATION (current baseline)

Last verified after the carousel work:

| Gate | Command | Result |
| --- | --- | --- |
| Types | `node_modules/.bin/tsc -b --pretty false` | exit 0 |
| Lint | `eslint` on changed files | 0 errors (Home has 4 pre-existing exhaustive-deps warnings) |
| Unit | `npm run test:unit` | **188 passed, 0 failed** (paint 42, theme 10, songclock 34, visualizer 38, lyrics 64) |
| Build | `vite build` | exit 0 (large-chunk warning only) |

Unit tests are plain node scripts, no runner. `lyrics.test.mts` has a live
section gated behind `LYRICS_LIVE=1`.

**Harness inventory (current unless noted):**
`appcheck` (BarGraph pixels), `vizcheck` (BarGraph modes, Butterchurn mount),
`uicheck` (visualizer/radio panel anchors), `cdcheck` (CD collection, gradient
presets), `headercheck`, `milkcheck` (.milk conversion), `playcheck`
(keep-alive latencies), `dragcheck` (pointer drag reorder), `scrollcheck`
(scroll monotonicity), `uibatch`, `final5`, `lyrcheck`/`lyrfix`,
`lyricscheck` (live provider chain), `lyricreadycheck` (green provider dot),
`queuefix` (the queue-panel contract), `chromecheck` (chrome drag/offset
editor), `soniccheck` (the two Sonic Topography ports: mount, first frame,
settings card, attribution, persistence, clean dispose), `nextprev`
(Next/Prev + queue ordering). Stale/legacy:
`drawercheck.mjs`, `playersettings-check.mjs`, `uiter.mjs` (early UI-period
shots). Root `.verify/` holds provider probes (`chainprobe`, `providerprobe`,
`unisonprobe`, …) and `.verify/provider-tests/` has one openable page per
provider. `app/.verify/` holds ad-hoc scratch scripts/shots.

---

## 4. ARCHITECTURE MAP

### 4.1 Audio engine — `src/hooks/useAudioEngine.ts`

Read the comments; they are load-bearing. Core rules:

- ONE media element per deck, captured via `captureStream()` into the analysis
  graph. The element is never routed through WebAudio. Never add a compressor
  on the element path.
- **Standby preload**: a second parked element holds the peeked-next track
  (`xfArmedRef`); natural end / NEXT promotes it (`promoteStandby`) instead of
  decoding. Armed records carry `shuffled` and are validated against the live
  mode/list.
- **Crossfade** (`beginXfade` / `takeoverFrom`): overlaps two elements; a
  generation counter aborts stale ramps. User pick/skip/pause aborts mid-ramp.
- **Volume normalization**: slow AGC in the 100 ms tick, RMS from the deck
  analyser, applied as `el.volume = userVol * normGain`. Skipped during ramps.
- **Radio**: own session element + `getRadioAnalyser()`. `tuneRadioViz(url)`
  keeps a private CORS-enabled, zero-gain element feeding the analyser; a
  CORS-refusing station nulls it and the deck fallback engages.
- **Keep-alive** (`lib/keepAlive.ts`): one second of true digital silence loops
  through the endpoint while paused so Windows never powers the output down
  (fixes 5–6 s resume delay). Never captured, no metadata.
- Public surface includes `playing`, `duration`, `shuffle`, `repeat`, `volume`,
  `busy`, `failed`, `select`, `playNext/playPrev`, `setVolume`, `seekTo`,
  `subscribeTime`, `getAnalyser`, `getRadioAnalyser`, `tuneRadioViz`, `prewarm`.

### 4.2 Library / playlists — `features/playlist/`

- `usePlaylist` owns the track list + ordering; `usePlaylists` owns folders and
  system playlists (`DOWNLOADS_FOLDER_ID`, `FAVOURITES_FOLDER_ID`).
- Persistence: IndexedDB `md-walkman`, stores `tracks`, `meta`, `lyrics`
  (`src/lib/library.ts`). Downloads Online is auto-created and non-deletable.
- Playback context: `playFromQueuePanel(trackId, folderId?)` in Home — a folder
  row makes that folder the playing context; a library row selects in place.

### 4.3 Layout system — `features/layout/` + `components/LayoutFrame.tsx`

Two different units, deliberately:

- **Stage panels use rectangles** (`LayoutBox {x,y,w,h}`, pixels) through
  `useLayoutBox(key)`; rendered by `LayoutFrame` (fixed, dashed border + 8
  resize dots only while editing, 4 px drag threshold, commits on pointerup,
  seeds from a measured docked position on first edit, `clampBox` on display).
  Current rectangle keys: `md-lyrics-box-on` (legacy `md-lyrics-box` migrates
  into it), `md-lyrics-box-off`, `md-queue-box`, `md-music-box`, `md-disc-box`,
  `md-cylinder-box`. Home remaps every box proportionally on window resize and
  `fullscreenchange`.
- **Everything else (corner buttons, header controls, popovers, footer) uses
  offsets** through `DraggableSurface` + `useChromeDrag`, stored as one record
  under `md-chrome-offsets`. Offsets apply via CSS `translate` (never clobber
  `transform`), are unbounded, and scale with viewport changes. `RESET SCREEN`
  clears them.
- One `editChrome` state gates both. Entering it seeds the five panels from
  their docked positions and turns on `lyrics.custom`; `SAVE LAYOUT` ends it.
  `body.layout-editing` disables text selection.
- `components/CustomizePanel.tsx` is the hub: CUSTOM POSITION, per-panel
  RESETs, EDIT LAYOUT + RESET SCREEN.
- The settings popovers (CD, wallpaper, visualizer, radio, lyrics settings,
  player settings, customize, extension, track meta, lyrics editor) carry
  `.panel-resizable` (`index.css`): native CSS `resize: both`, min 210×150,
  max viewport − 16 px, restyled grip. Sizes are session/CSS-only; only
  positions persist.

### 4.4 Queue + playlists hub — `components/QueuePanel.tsx` (+ `.css`)

The single surface replacing the tracklist and the drawer (the old
`PlaylistPanel` remains mounted hidden as rollback; `PlaylistDrawer` is no
longer imported). Features:

- Two tabs (`q` queue / `p` playlists) with an animated thumb; search overlays
  the toolbar; playlists are list rows with open/rename/delete/upload.
- Queue = current track pinned first, then play-next, then context rotated at
  the playhead so the row under the current one IS what Next plays.
- Rows: art play button, pencil editor (title/artist/cover + lyrics editor),
  add-to-queue/playlist menu (`+`), X to remove. A queued row removes from the
  play-next list; a context row is hidden locally via the `skipped` set (never
  deletes from the playlist). The current row has no X.
- Pointer drag reorder with grip, ghost/lift, edge auto-scroll; queued rows
  reorder `nextUp`, context rows reorder the playing folder.
- Glass settings pop (`md-qp-glass`: transparency/blur/refraction/radius) driven
  by `liquid-gl` with a CSS fallback; global Blurred/Solid (`md-glass`) drops or
  rebuilds the lens.
- Pin + auto-hide from the dock edge (`md-qp-side`/`md-qp-width` are legacy
  reads; sizing now belongs to the layout editor).
- Downloads Online refresh button (serialized sync passes, deadline-guarded).
- Hosted in a `LayoutFrame` when `queueFramed` (edit mode or saved box).

### 4.5 Lyrics — `components/LyricsPanel.tsx` + `features/lyrics/`

- `@uimaxbai/am-lyrics` renders word-synced TTML. `installProviderChain.ts`
  replaces its fetch so the app owns the whole chain; its own parser/renderer
  and footer state stay authoritative.
- `registry.ts`: **11 providers, all reachable** — Tier 1 `unison`,
  `betterlyrics`, `betterlyrics-qq`, `netease`, `paxsenix-word`, `kugou`,
  `lyricsplus`; Tier 2 `lrclib`, `paxsenix-line`, `lrc-red`; Tier 3
  `lyrics-ovh`. Dead routes (QQ hosts, Genius, AZLyrics, Musixmatch web,
  YouTube captions) were probed and removed; do not re-add without a fresh probe.
- `order.ts` keeps the user's order under `md-lyrics-provider-order` and repairs
  it when the registry changes. `ProviderList.tsx` is a pointer-drag reorder
  list with tier badges; clicking a provider forces it for the current track.
- Transport: `features/lyrics/http.ts` uses the shell command
  `lyrics_http_get(url, referer, timeout_ms)` (Rust, `src-tauri/src/lyrics.rs`)
  when in Tauri; browser fallback is direct fetch + a small CORS-proxy pool with
  per-host circuit breaker. Providers run in parallel; the user's order decides
  the winner; chain deadline 8 s, per-provider budget 6 s.
- Faces: `WHITE_CHROME` (default, hard white), `METAL_CHROME` (pinned lyric +
  CD on only; palette + emboss, **never** `background-clip: text` — it desynced
  in WebView2). `BG_HIDE_CHROME` hides background-vocal echo containers (the
  old “ghost lyric layer”). The component header/footer are hidden; a small
  provider badge + green dot is the only chrome.
- Pinning stores TTML in IndexedDB (`lyrics` store) per track; the editor and
  per-track offset live in `md-*` metadata. Empty state is a phase machine
  (`searching → none`) with a multi-artist fallback.
- Position: standard on/beside-disc (rendered INSIDE `discAssembly`, so moving
  the disc carries the lyrics) or a custom `LayoutFrame` rectangle saved per CD
  state. Home picks `metal={cdVisible && !!localLyrics && !radio.song}`.

### 4.6 Visualizers

- Native MilkDrop engine: Rust `src-tauri/src/visualizer/*`; front-end bridge
  `features/visualizer/useVisualizer.ts` (presets, textures, mode, PCM).
- JS backdrop styles: `features/voltviz/` (`VoltVizBackdrop` mounts modules into
  a black container with crossfade; `BarGraph`, Butterchurn, …). `BarGraph` has
  tricky pixel-cache rules — read the file before touching it.
- **Sonic Topography ports (GPL-3.0 — different licence from VoltViz's MIT)**:
  `impl/SonicTopography.tsx` (© CmzYa) and `impl/SonicTopographyExtended.tsx`
  (© Netesfiu) are the two Wallpaper Engine wallpapers rebuilt as plain
  three.js scenes in the factory/frame contract; upstream's `AudioEngine.ts`
  lives in `sonic/` with Wallpaper Engine's listener replaced — the original
  reads a 64-bin 0–22 kHz frame resampled by frequency from the deck analyser,
  the extended feeds a real stereo 128-value frame from two channel analysers.
  Each carries its own settings card (`Overlay`: theme select, ripples/meteors/
  idle-wave/spin/peak toggles, intensities) persisted under
  `md-voltviz-sonic-topography(-extended)`; the shared SENSITIVITY/SPEED/SCALE
  sliders map to tap gain, shader-time rate and camera zoom. Full provenance
  and licence notes in `features/voltviz/README.md`; GPL text at
  `features/voltviz/sonic/LICENSE`.
- `components/ChromeVisualizer.tsx` draws the reactive ring around the disc.
- `VisualizerPanel.tsx` is the settings surface; `VoltVizBackdrop` shows a
  WebGL-explanation message when a style cannot start.

### 4.7 Radio

`features/radio/useRadio.ts` (radio-browser.info stations, ICY metadata, song
clock, stream-end detection), `lib/icy.ts`, `lib/radioLevel.ts`,
`lib/radioBrowser.ts`, `lib/radioTap.ts` + Rust `radio_tap` (shell fetches a
CORS-less stream and re-serves it on the loopback server with `*`, so the
analyser can read it). Radio holds its own session element and visual source
(`md-radio-viz`); the `?? getAnalyser()` fallback in Home’s `vizAnalyser` is
load-bearing — keep it.

### 4.8 ONLINE / Dannify

Vendored Python app in `dannify/`, opened by the extension hub in its own
window (`features/dannify/DannifyWindow.tsx`); bridge routes live in
`player_bridge.py`. `useDannifySync` imports finished downloads into the
Downloads Online system playlist (WebSocket instant path + serialized manual
REFRESH with timeouts).

### 4.9 Cylinder Carousel — `components/CylinderCarousel.tsx` (+ `.css`)

Ported from a standalone HTML demo, stripped of its fake audio/data and wired
into the app:

- Props: `tracks` (Home passes `carouselTracks` = a stable slice of
  `visibleTracks`), `currentId`, `playing`, `subscribeTime`, `duration`,
  `getAnalyser`, `editing`, `focusedIndex` + `onFocusChange`, `onPlay`,
  `onToggle`.
- Clicking a card calls the same global path as queue rows
  (`playFromQueuePanel`), or toggles when it is the current track. The ring
  auto-centres on the engine’s current track and reports focus up to Home.
- One RAF loop drives the ring; drag (6 px threshold), wheel and
  ArrowLeft/ArrowRight move it. Pointer capture is taken only after the drag
  threshold so card clicks survive.
- Pulse reads the deck’s existing analyser in a separate RAF while playing; no
  second AudioContext. No analyser → static cards.
- **The container is transparent** (`background: none`, no border/shadow/blur);
  only the individual cards are frosted glass, so the wallpaper/visualizer
  shows through. The header carries no “Songs” label; the gear appears only in
  edit mode, with 10 sliders persisted under `md-cylinder-settings`.
- Docked 176 px above the player in the deck column with the slot reserved while
  framed; its own layout box is `md-cylinder-box`; RESET lives in Customize.

### 4.10 Rust shell

`src-tauri/src/` — `lib.rs` registers all commands. Highlights:
`sources/*` (multi-provider registry/search/play/downloads, `radio_tap`,
YouTube/Spotify commands), `visualizer/*` (MilkDrop engine, presets, PCM),
`lyrics.rs` (`lyrics_http_get` with caller timeout + abort),
`dannify.rs` (extension window/account). `tauri.conf.json` sets
`additionalBrowserArgs` for WebView2 (`--enable-unsafe-swiftshader
--ignore-gpu-blocklist`) so WebGL visualizers can start.

### 4.11 Persistence keys (localStorage)

Layout: `md-chrome-offsets`, `md-queue-box`, `md-music-box`, `md-disc-box`,
`md-cylinder-box`, `md-lyrics-box-on/off`, `md-lyrics-custom`.
Queue/player: `md-qp-glass`, `md-qp-width`, `md-qp-side`, `md-glass`.
Playback: `md-track`, `md-playlists`, `md-selected-playlist`, `md-shuffle`,
`md-repeat`, `md-volume`, `md-crossfade`, `md-crossfade-sec`, `md-normalize`,
`md-accent-art`. Lyrics: `md-lyrics-provider-order`, `md-lyrics-title`,
`md-lyrics-*`. Visualizer/wallpaper/CD: `md-voltviz*` (incl.
`md-voltviz-sonic-topography(-extended)`, the two Sonic ports' own settings
records), `md-bargraph-*`,
`md-bc-*`, `md-wall-*`, `md-cd-*`, `md-radio-*`. Boot/safety: `md-boot-attempts`,
`md-safe-mode`, `md-hard-reset`, `md-fatal`. IndexedDB `md-walkman` holds
tracks, meta, pinned lyrics, disc art collection, Butterchurn customs and
wallpapers.

---

## 5. CURRENT UI/UX STATE (the overhaul)

- **Chrome editor**: every corner/header button, popover and the footer can be
  nudged anywhere; offsets persist and scale with the viewport; `RESET SCREEN`
  restores them. Unbounded movement is intentional.
- **Five stage panels** are freely movable/resizable in the one edit mode:
  lyrics (per CD state), queue, player, disc, carousel. Rectangles persist;
  viewport changes remap them proportionally.
- **Queue/playlists hub** replaced the tracklist and drawer (see 4.4). It docks
  at a screen edge, auto-hides unless pinned, and has liquid-glass settings.
- **Player settings** moved out of the queue panel to a main-screen corner knob
  (`PlayerSettingsPanel.tsx`): crossfade + steps, normalize, accent-from-art,
  Blurred/Solid. The queue header keeps glass, pin, and the playlist-create
  button; no player controls live there.
- **MusicControlPanel.tsx** is the new cast-glass transport body (props pass
  through; no logic) used docked and framed.
- **ExtensionPanel.tsx** is the corner hub; ONLINE (Dannify) is its first entry.
- **Settings panels are resizable** via native `.panel-resizable` corners and
  share the same glass tokens; resizing is not persisted.
- **Disc + lyrics**: on/beside-disc lyrics now live inside the disc assembly;
  moving the disc moves its lyrics. The CD itself is a layout surface.
- **Visualizer/radio**: radio got a native loopback tap so CORS-less stations
  can drive the analyser; WebGL failures show a plain explanation; WebView2
  args were added so GPU visualizers work.
- **Cylinder Carousel** is the new songs widget above the player (see 4.9).

---

## 6. RECENT WORK (all uncommitted since HEAD `6eeeee2`)

1. **Unified queue/playlists hub** — new `QueuePanel.tsx`/`.css` with tabs,
   search, folder management, track editor, pointer drag reorder, local
   context-row removal, glass settings, pin/auto-hide; the old tracklist is
   kept mounted hidden (the drawer file is no longer imported). Home’s queue
   callbacks/state live near the top of the file; `md-queue-box` is its layout
   rectangle.
2. **Generalized layout editor** — `useChromeDrag`/`useChromeLayout` +
   `DraggableSurface`; all buttons/popovers draggable by offsets; one
   `editChrome` mode; `LayoutFrame` extended to player, disc and carousel;
   `CustomizePanel` rewritten as the hub; `chromecheck.mjs` covers it.
3. **UI consolidation** — `MusicControlPanel`, `PlayerSettingsPanel`,
   `ExtensionPanel`, `panel-resizable` on the settings popovers, compact glass
   action chips in `QueuePanel.css`, footer/header cleanups.
4. **Lyrics stack** — provider registry/order/chain/install/transport (11
   providers), shell `lyrics_http_get`, parallel fetches with order deciding the
   winner, per-track pinning/editor/offset, white + metal faces, hidden
   component chrome, background-vocal suppression, provider badge + green dot.
5. **Radio/visualizer fixes** — shell `radio_tap` loopback for CORS-less
   stations, retry/resume handling, WebView2 GPU args, `failedStartMessage()`,
   capture stream re-taken on every play.
6. **Disc/lyrics layout** — `md-disc-box` frame, on/beside-disc lyrics inside
   `discAssembly`, RESET CD in Customize.
7. **Cylinder Carousel** — new widget (4.9), transparent container, edit-only
   gear/settings, real tracks/engine state, no second audio graph.
8. **UI/UX polish pass (latest session)** — carousel feathered (mask on
   `.cyl-stage`, container forced transparent/unshadowed), carousel sliders
   isolated from the frame drag (`stopPropagation`), carousel box UNBOUNDED
   (`LayoutFrame unbounded` + `clampLoose`); every settings panel got the
   thin scrollbar (global rule on `.settings-panel`/`.panel-resizable`);
   edit-mode resize FIXED (the drag capture-handler no longer swallows
   presses on the native resize grip — `useChromeDrag` bails in the bottom-
   right 22px) and radio opens on a plain CLICK while editing; the radio /
   CD-settings / wallpaper-settings toggles moved INTO the transport row
   (`ModeButton` variants; hold-to-open kept outside edit mode), the
   floating stage buttons are gone; volume slider capped at 150px; the
   BUFFERING/failure strip deleted outright; favourite hearts added
   (transport `ModeButton fav` = solid `#a82e2e`, queue panel playlist-row
   hearts toggling FAVOURITES membership — never in the Current queue tab);
   lyrics: 2rem padding-top (Hindi clipping), ON DISC/BESIDE DISC buttons
   removed (props `mode`/`onMode` dropped from LyricsSettingsPanel), provider
   tag + green dot + SEARCHING pill removed (`data-lyrics-ready` is gone
   with it — harnesses that keyed on it need updating); CURRENT LINE pill
   centred via the `translate` PROPERTY (panel-in's animation fill clobbers
   translateX utilities) with a chrome bar filling scaleX left→right.
   Verified: tsc clean, eslint 0 errors (4 baseline warnings remain),
   188 unit tests green, `.verify/polishcheck.mjs` 21/21.
9. **Sonic Topography ports (latest session)** — the two GPL-3.0 Wallpaper
   Engine wallpapers (CmzYa's Sonic Topography + Netesfiu's extended fork)
   integrated as voltviz styles: plain-three scene ports of `MapScene.tsx` +
   `CustomShaderMaterial.tsx` in `impl/SonicTopography{,Extended}.tsx`,
   upstream audio engines ported into `sonic/` with WE's listener replaced by
   analyser-fed 64-bin frames (extended: a real stereo 128-value frame from a
   channel splitter), themes + per-visualizer settings in `sonic/`
   (`settings.ts`, GPL `LICENSE`), each with an Overlay settings card
   (theme/ripples/meteors/idle-wave/spin/peak + intensities) and attribution;
   registry, `blackFor` and the panel caption updated; `three186.d.ts` added
   (the alias package ships no types). Verified: tsc clean, eslint clean,
   188 unit tests green, `vite build` exit 0, `.verify/soniccheck.mjs` 16/16,
   full `vizcheck` mounts all 17 styles. Audible/audio-reactive verification
   in the real WebView2 window still owed.

---

## 7. OPEN THREADS / CAVEATS

- **Nothing is committed since `6eeeee2`** beyond the Sonic Topography batch
  (see Recent Work 9). The rest of the working tree — the whole overhaul +
  carousel — is still uncommitted. Commit in themed batches when the user asks.
- **Audible verification still owed on real hardware**: crossfade/standby swap,
  the radio loopback tap, and the pause keep-alive. Headless proves code paths
  and UI, not sound.
- **WebGL in WebView2**: the `additionalBrowserArgs` change is in place but the
  real window is the only proof for shader-heavy visualizers.
- **Harness boot overlay**: `#boot` can remain in headless and eat pointer
  events; remove it or wait for `.gone`. See §2.
- **`panel-resizable` sizes are not persisted** (only chrome offsets and stage
  rectangles are). A panel resized by the corner grip returns to its CSS size
  next session.
- **Chrome offsets are unbounded** — a surface can be parked off-screen.
  `RESET SCREEN` in Customize is the recovery.
- **Old surfaces are rollback, not dead**: `PlaylistPanel.tsx` and the
  `tracklistPanel` element in Home stay mounted hidden; `PlaylistDrawer.tsx`
  remains on disk but is no longer imported. A comment in `useChromeLayout.ts`
  still mentions `md-tracklist-box`; harmless.
- **README is stale** about the tracklist/queue; this handoff is authoritative.
- **Provider services are flaky by nature**: live lyrics only prove themselves
  with `LYRICS_LIVE=1` / `cargo test --lib the_shell_can_reach_every_provider
  -- --ignored`. Do not re-add a provider marked dead without a fresh probe.
- **Scratch clutter**: root `.verify/` probes, `app/.verify/`, and
  `app/nextprev-*.png` / `app/queuefix-*.png` are uncommitted diagnostics;
  leave unless the user asks for cleanup.
- **Pre-existing lint**: Home.tsx has four exhaustive-deps warnings (no
  errors); the current changed set has no lint errors.

---

## 8. HOW THE USER WORKS (match this)

- Batches of numbered items with explicit acceptance criteria. Confirm each
  item briefly (files touched + how the criterion is met).
- “Do not redesign anything else — keep the existing layout, tokens and
  behaviour intact” is a standing constraint. Prefer hidden-not-removed.
- They verify visually on their machine and report with screenshots; treat
  their repro as ground truth over your theory.
- They value root-cause fixes over patches. When a cause is not provable from
  reading, run a small pixel/DOM control experiment.
- Keep answers short and concrete; no filler.
