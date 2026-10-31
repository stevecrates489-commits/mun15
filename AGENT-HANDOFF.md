# AGENT HANDOFF — MUN15H project

Read this before doing anything in this repo. It is the working context of the
agent session(s) that built the current state of the player — the environment
quirks, the verification workflow, what was changed and why, and what is still
open. Keep it updated after significant work.

---

## 1. WHAT THIS PROJECT IS

**MUN15H MiniDisc Player** — a desktop music player: Tauri 2 + React 19 +
TypeScript + Vite 7 + Tailwind 3 (shadcn/Radix) front end, a Rust shell, and a
vendored Python app ("Dannify") serving as the online side in an iframe.

```
C:\Users\aryan\Documents\aim project\
├── AGENTS.md                  ← graft context-graph instructions (read it)
├── AGENT-HANDOFF.md           ← this file
├── graft/                     ← generated repo context graph (gitignored, regenerable: graft build)
├── 3D Music Player with CD Animation\
│   ├── app\                   ← the player (npm/Vite/Tauri)
│   │   ├── src\
│   │   │   ├── pages\Home.tsx          ← orchestrator (~2300 lines, everything hangs off it)
│   │   │   ├── components\             ← PlaylistPanel, PlaylistDrawer, LyricsPanel,
│   │   │   │                              DiscCase (3D CD), Transport, RadioPanel,
│   │   │   │                              CdSettingsPanel, VisualizerPanel,
│   │   │   │                              WallpaperSettingsPanel, ColorPicker, ui\
│   │   │   ├── hooks\useAudioEngine.ts ← THE audio engine (element lifecycle,
│   │   │   │                              crossfade, standby preload, normalization,
│   │   │   │                              media session, capture-graph)
│   │   │   ├── features\
│   │   │   │   ├── voltviz\            ← backdrop visualizers (impl\*, audio.ts, VoltVizBackdrop)
│   │   │   │   ├── dannify\            ← extension bridge sync (downloads.ts, useDannifySync.ts)
│   │   │   │   ├── radio\, lyrics\, playlist\, disc\, wallpaper\, sources\, visualizer\
│   │   │   ├── lib\                    ← library.ts (IndexedDB), accent.ts, icy.ts, color.ts …
│   │   │   └── types\                  ← module shims (milkdrop-preset-converter.d.ts)
│   │   ├── src-tauri\                  ← Rust: sources/ (multi-provider registry), visualizer/ (MilkDrop engine), dannify.rs
│   │   ├── tests\                      ← plain-node unit tests (paint, theme, songclock, visualizer)
│   │   └── docs\                       ← four excellent architecture docs (INTEGRATION_CONTRACT etc.)
│   ├── dannify\                        ← vendored Dannify v4.14.1 (Python) + 5 player-owned bridge files
│   │   └── player_bridge.py            ← the player's routes/wrapper AROUND Dannify (owned, editable)
│   └── .verify\                        ← UI verification harnesses (playwright-core, msedge channel)
└── .git\                               ← real repo (branch main, commit 0b67541 = initial import)
```

Git: the repo is `aim project` itself (NOT the home directory). Everything
since `0b67541` is **uncommitted working tree** — large batches of work sit
uncommitted; commit deliberately when the user asks.

Docs worth reading before deep work: `app/docs/INTEGRATION_CONTRACT.md`
(Dannify seams), `app/docs/ONLINE_SOURCES.md` (provider registry rules),
`app/docs/ONLINE_SECTION.md`, `app/docs/YOUTUBE_PIPELINE.md`.

---

## 2. ENVIRONMENT QUIRKS (critical — this machine's shell is broken)

The session shell is **Git Bash with a Windows-style PATH** — plain `ls`, `git`,
`npm`, `cat`, `head`, `wc`, `sleep` are ALL missing (`command not found`).
Workarounds that work:

- **git**:  `"/c/Program Files/Git/cmd/git.exe" -C "C:/Users/aryan/Documents/aim project" <cmd>`
- **npm/npx**: `cd` into `app/` first, then `"/c/Program Files/nodejs/npm.cmd" …`
  or `"/c/Program Files/nodejs/npx.cmd" tsc -b --pretty false`
- **node**: `"/c/Program Files/nodejs/node.exe"`
- **PowerShell**: `"/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -File <script.ps1>`
- **curl**: `/c/Windows/System32/curl.exe`
- **ripgrep**: `/c/Users/aryan/AppData/Local/Programs/ZCode/resources/tools/ripgrep/rg.exe`
- **no coreutils at all** — no `sleep` (use `node -e "setTimeout(...)"`),
  no `head/tail/wc` (pipe through rg, or use PowerShell script files).

**PowerShell `$` interpolation trap**: inline `powershell -Command "...$_..."` —
bash eats `$var`. NEVER inline non-trivial PowerShell. Write a `.ps1` script
file (temp dir is fine) and run it with `-ExecutionPolicy Bypass -File`.

**rg regex traps**: no `(a|b)` alternation errors come from unescaped `^` or
`{`; prefer multiple simple rg calls over one clever one.

**Dev servers for verification**: start with
`"/c/Program Files/nodejs/npx.cmd" vite --port 5210 --strictPort` (background
task), wait ~15-40s (cold dep-optimize), probe with curl. Stale instances
happen — a listener may hold `::1` only (curl `127.0.0.1` fails, `localhost`
gives 404 = something stale). Check listeners with PowerShell
`Get-NetTCPConnection -LocalPort <p>` and `Stop-Process -Id <pid>`. ALWAYS stop
your server before finishing (`Stop-Process` by port owner).

**The `graft` CLI** is not reachable in this shell (Windows npm global, broken
PATH). The `graft/` graph files can be read/grepped directly, or use
`cmd.exe /c "graft …"` if needed.

**Windows `>nul` redirect in Git Bash creates a literal file named `nul`** —
use `>/dev/null`, and delete any stray `nul` file that appears at repo root.

---

## 3. VERIFICATION WORKFLOW (how every change is proven)

1. **Type-check**: `npx tsc -b --pretty false` in `app/` (must be empty + exit 0).
2. **Lint**: `npx eslint <only the files you touched>`. Do NOT run bare
   `eslint .` as a gate — the repo has pre-existing lint errors (baseline in
   `app/.lint-baseline.log`): empty `catch {}` blocks in `lib/library.ts`,
   `setScrolled(false)` inside LyricsPanel's build effect, `setOwnCard` in
   VisualizerPanel's effect, Transport's empty catch, two exhaustive-deps
   warnings in Home.tsx (lines ~627, ~876). Leave them; flag if yours differ.
3. **Unit tests**: `node tests/paint.test.mts`, `theme`, `songclock`,
   `visualizer` (run all four; 124 tests).
4. **Python**: after touching `dannify/player_bridge.py`:
   `./dannify/.venv/Scripts/python.exe -m py_compile dannify/player_bridge.py`
5. **Live UI harnesses** (`.verify/*.mjs`, run with `"/c/Program Files/nodejs/node.exe" <name>.mjs`):
   - All use `playwright-core` + `chromium.launch({ channel: 'msedge', headless: true })`
     (the machine has no bundled browsers; msedge works).
   - **Tauri shim is REQUIRED** — the shell calls `getCurrentWindow()` during
     render and dies in a plain browser. Inject before load:
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
   - `waitUntil: 'networkidle'` hangs on a cold Vite (HMR websocket +
     re-optimizing deps) — use `{ waitUntil: 'domcontentloaded' }` + 4s wait.
   - `.mjs` harness files are PLAIN JS: no TS `as`/type annotations anywhere,
     including inside `page.evaluate` callbacks.
   - In-page module tests: `await import('/src/features/...')` inside
     `page.evaluate` works (Vite serves transformed TS) — importing a `.tsx`
     with JSX from a BLANK page fails (React preamble); do it from the app
     page itself.
   - React state + assertions race: after dispatching events that setState,
     `await` two rAFs before reading the DOM.
   - Long-running harnesses: log results incrementally and use
     `.catch()` + `force: true` on flaky clicks so partial results survive.

Harness inventory (`.verify/`): `appcheck.mjs` (BarGraph pixel suite: Full
White rendering, palette round-trip, left-edge stability, bar independence),
`uicheck.mjs` (frame-bars-gone, visualizer panel anchor, radio panel + exit
animation; radio opens via 450ms HOLD of `button[aria-label="Radio (hold)"]`),
`cdcheck.mjs` (CD collection flyout, hidden cover options, gradient preset
save/rename), `vizcheck.mjs` (BarGraph bg-toggle pixel modes, Butterchurn
mount), `drawercheck.mjs` (player settings in drawer), `headercheck.mjs`
(header redesign: chip counts, TRACKLIST bar gone, footer row, scroll-to-blur
header-only), `milkcheck.mjs` (milkdrop-preset-converter output shape),
`playcheck.mjs` (keep-alive: element looping through pauses, first-play /
short-resume / 65s-resume latencies), `dragcheck.mjs` (pointer drag: ghost
lifts + follows, origin parked, marker, order commits, click still plays,
cleanup), `uibatch.mjs` (the 11-item batch: cursor, backdrop canvas across
track changes, radio toggle, header z, HUE gone, hints gone, stepper
alignment, next/prev stepping), `final5.mjs` (rendered-white lyric with CD
off, dark select CSS, star template ships). HARNESS TRAP (found the hard way): the boot intro `#boot` overlay
(z-index 99999, a canvas) still holds the window under the Tauri shim — its
auto-exit gate can leave it up, and the first real pointerdown is EATEN by
it (synthetic dispatches on the row bypass it and look fine). Dismiss it
first: click once (e.g. 20,880) and poll until `#boot` is gone/display:none.

---

## 4. ARCHITECTURE NOTES (the non-obvious parts)

**Audio engine** (`useAudioEngine.ts`) — read its comments; they are load-bearing:
- ONE media element per "deck", captured via `captureStream()` into the
  analysis graph (element is NEVER routed through WebAudio — that rule makes
  silence structurally impossible). Never add a DynamicsCompressorNode on the
  element path.
- **Standby preload**: a second parked element holds the peeked-next track
  (`xfArmedRef`), so track switches are element swaps, not decodes. On
  natural end / NEXT (auto or playing): `promoteStandby()` swaps roles.
  Manual prev / arbitrary select still decode on demand. NEXT-while-paused
  loads without autoplay (semantics preserved).
- **Crossfade** (`beginXfade`): overlap on the second element; `takeoverFrom`
  is the shared handover (listeners via `attachElementListeners`, capture
  re-established via `watchDeckRef`, generation counter `xfGenRef` aborts
  stale ramps). Any user pick/skip/pause aborts mid-ramp.
- **Volume normalization**: slow AGC in the 100ms tick — RMS from the deck
  analyser, divided by element volume, eases `normGainRef` (0.35–2.4),
  applied as `el.volume = userVol * normGain`. Reset per track. Skipped
  during crossfade ramps.
- **Radio** plays on its own session element (`getRadioElement`), captured
  into the deck gain via `attachSource`. A dedicated radio-only analyser
  (`getRadioAnalyser`) exists for the visualizer source switch.
- **VISUALIZER SOURCE**: `Home.tsx` `vizAnalyser` callback —
  `radioViz ? (getRadioAnalyser() ?? getAnalyser()) : getAnalyser()`.
  The `?? getAnalyser()` fallback is LOAD-BEARING: `md-radio-viz` persists in
  localStorage, and without the fallback a persisted ON with no station
  leaves every voltviz visual reading null → silence → "black screens".
  This exact bug was fixed once; do not regress it.

**VoltViz backdrop** (`features/voltviz/`): `VoltVizBackdrop` mounts factory
modules into a black container (`blackFor` list) with crossfade; modules read
`audio.spectrum()` from the shared frame source. `BarGraph` has known-tricky
bits: `alpha: true` canvas + optional `clearRect` (SHOW BACKGROUND toggle,
`md-bargraph-bg`), colour cache is a single `painted` string that MUST be
re-synced at the background fill (per-bar caching caused the Full White
vanish), low-end tilt `lowGain` is eased (raw = left-edge pumping), bars use
band mapping + interpolation (nearest-bin made left bars move in pairs).

**Dannify bridge**: `player_bridge.py` adds `/api/player/*` routes in front of
Dannify's own app; nothing of Dannify's is edited. The bridge joins the vault's
full `artists` list (multi-artist fix); LyricsPanel fetches lyrics with the
full artist string first, then rebuilds once against the primary artist
(`artistFallback`) before the empty state.

**UI conventions**: house style = comments written as prose explaining WHY,
mono uppercase micro-labels, `chrome-range` sliders, glass panels
(`settings-panel fx-blur rounded-2xl border-white/15 bg-black/NN backdrop-blur`),
FloatingMenu-style portaled popovers, `previous-key` render-phase state resets
(NOT setState-in-effect — the eslint react-hooks rules are strict here; new
code must avoid setState sync in effect bodies).

---

## 5. WHAT WAS DONE (sessions up to this handoff — newest last)

1. **git repo created** for `aim project` (was untracked inside the home dir);
   `.gitignore` covers target/node_modules/.venv/ffmpeg/graft/.verify images.
2. **BarGraph fixes**: Full White invisibility (context-fillStyle cache),
   left-edge flicker (eased low-end tilt + full clear), paired left bars
   (band interpolation), overlay alignment.
3. **Radio VISUAL decoupled** from global visualizer state; radio-only
   analyser added (`getRadioAnalyser`); persisted as `md-radio-viz`.
4. **Tracklist perf**: scroll handler rAF-coalesced; stable row handlers
   (inline `onContextMenu` defeated memo).
5. **Visualizer panel anchored** top-left under the header circle (top 4.5rem).
6. **Butterchurn**: favorites (md-bc-favs), hide-from-rotation (md-bc-hidden),
   persisted Auto-Cycle/Random-Next (md-bc-cycle / md-bc-random).
7. **FrameBars removed** completely (component, lib, CSS, toggle).
8. **Radio**: favorite-from-search pushes Known instantly; buffering spinner;
   280ms close animation (`panel-out-soft`); station names keep real metadata
   on re-play (no URL-as-name); ICY placeholder titles ("No title" etc.) filtered.
9. **Header redesign**: chips with counts, TRACKLIST bar removed, footer
   count/duration row, scroll-to-blur header-only. (CURRENT WORKING TREE.)
10. **Player settings** (crossfade 0/3/5/8s + normalize) live in the
    **playlists drawer** (PlaylistDrawer.tsx), NOT the main tracklist panel.
11. **Accent from Art**: hand-rolled dominant-color extraction
    (`lib/accent.ts` + `lib/useAccent.ts`) → CSS vars
    `--accent-a/b/glow/row` animated 800ms; toggle in Wallpaper Settings
    (`md-accent-art`); consumers: seekbar, active row, progress lines.
12. **Media Session**: seekto/seekbackward/seekforward added (metadata +
    play/pause/prev/next already existed).
13. **CD settings**: TRACK/PLAYLIST COVER options hidden (`<div hidden>`, code
    kept); **CD Collection** flyout (portal, hover-open, IndexedDB-backed
    `discArtCol:*` records, CLEAR ALL two-step confirm, multi-select delete,
    click-to-wear).
14. **Gradient presets**: save/name/rename list in ColorPicker
    (`md-wall-gradient-presets`).
15. **Lyrics**: strict-white default vs metallic-on-CD (`md` metal sheets in
    LyricsPanel, tied to `cdVisible` via `metal` prop); cute empty state
    (`.no-lyrics` hidden; placeholder after ~11s poll, "JUST VIBING 🎵").
16. **CD rotation decoupled from seeking** (scratch no longer flings the disc;
    0.0x = still).
17. **.milk import** in Butterchurn: `milkdrop-preset-converter@0.1.2` (npm),
    lazy chunk, UMD resolved via default→namespace→`window.milkdropPresetConverter`,
    customs persisted in IndexedDB `bcCustom:*`, ◆ marker, per-custom delete,
    verified PASS against a synthetic MD2 preset (`milkcheck.mjs`).
18. **This handoff file.**
19. **Lyrics custom position** (first pass): `md-lyrics-custom` toggle +
    `md-lyrics-box`, `LyricsCustomFrame` (since replaced — see 20),
    verified by `lyrcheck.mjs`.
20. **Customize / layout editor system** (current working tree):
    - `features/layout/useLayoutBox.ts` — `LayoutBox {x,y,w,h}`, `clampBox`
      (viewport clamp, MIN 160×120), `useLayoutBox(key, legacyKey?)` with
      legacy migration.
    - `components/LayoutFrame.tsx` (replaced LyricsCustomFrame) — shared
      drag/resize frame for lyrics AND tracklist; chrome (dashed border +
      8 handles) only while `editing`; drag threshold 4px keeps clicks
      working; commits on pointerup; seeds on mount when box is null.
    - **Two lyrics boxes**: `md-lyrics-box-on` / `md-lyrics-box-off` per CD
      state (`md-lyrics-box` migrates into the CD-on slot); Home picks by
      `cdVisible` (`lyricBox`/`commitLyricBox`).
    - Tracklist: `md-tracklist-box`; when saved/editing the PlaylistPanel
      renders inside a LayoutFrame at the top of Home (extracted as
      `tracklistPanel` const; dock slot in the deck column is what a
      first edit measures via `tracklistPanelRef`). RESET in the
      Customize panel clears the box.
    - Edit sessions are transient state in Home (`editLyrics`,
      `editTracklist`); the floating **SAVE LAYOUT** pill (bottom center)
      ends them; body gets `layout-editing` class → `user-select: none`
      (index.css) so drags never select text; handles also preventDefault.
    - `components/CustomizePanel.tsx` + a third corner button
      (`aria-label="Customize layout"`, right-36 top-14): holds the moved
      CUSTOM POSITION toggle, EDIT LYRICS LAYOUT, EDIT TRACKLIST LAYOUT,
      tracklist RESET. Lyrics Settings no longer has the toggle.
    - Verified by `lyrcheck.mjs` (full pass): edit chrome lifecycle, no text
      selection, CD-split switching, persistence, tracklist move/resize/
      reload/reset, customize panel contents.
21. **Tracklist scroll de-bounce** — `overflow-anchor: none` on
    `.playlist-scroll` (scroll anchoring fought the windowing); the
    active-row `centerOn` effect now runs ONLY when `activeTrackId` really
    changes (a `rowH` re-measure or length change rebuilt `centerOn` and
    re-ran the effect mid-scroll — the "yank backward"); window overscan
    pad 8→12. Verified by `scrollcheck.mjs` (fling monotonicity).
22. **Downloads Online = system playlist** — auto-created on load
    (`ensureDownloads` in usePlaylists), `deleteFolder` refuses `-2`,
    DELETE hidden in both drawer spots (⋯ menu + open-folder trash).
23. **Downloads refresh** — REFRESH button in the panel toolbar, only while
    the Downloads Online view is active (`onRefreshDownloads` prop →
    `dannifySync.sync()`), spins while in flight. The instant path
    (`onDannifyDownloadsDone` WS) already existed; see §6 caveat.
24. **Radio visualiser fix** — ROOT CAUSE: the audible radio element is
    cross-origin without CORS → its capture is SILENCE to the Web Audio
    graph (documented in lib/radioLevel; attachSource routed that tainted
    capture into the analysers). Fix: `tuneRadioViz(url)` in the engine
    keeps a private second element (`crossOrigin='anonymous'`, muted via a
    zero gain) feeding `radioAnalyserRef`; Home tunes it to
    `radio.current.url`; a CORS-refusing station nulls the analyser so the
    deck fallback engages. Verified by reasoning + type-check only —
    a REAL station listen is still owed (headless cannot prove audio).
25. **UI/persistence/logic batch** (verified by `uifix.mjs`, full pass):
    - Tracklist header frost: the wheel-blur tint `rgba(8,10,16,…)` →
      constant `rgba(255,255,255,0.05)`; blur 0 paints nothing.
    - BarGraph settings persist: `md-bargraph-{palette,bars,intensity}`
      (factory owns state, Overlay seeds from the same keys). **Trap fixed
      during verify: `Number(null)` is 0 — readNum must return the fallback
      for a missing key or every unset setting clamps to its floor.**
      Settings card rows now share one grid (labels + controls aligned).
    - RadioPanel LYRICS toggle (next to VISUAL) → `lyrics.toggle`.
    - Dannify sync passes are now SERIALIZED on a promise chain
      (useDannifySync) — the old busy-guard swallowed clicks mid-pass and
      could double-import. REFRESH shows CHECKING…/spinner immediately and
      a `+N ADDED`/`UP TO DATE` note when its pass lands (the pass can take
      ~25s while the extension's likes list times out — that is the
      extension's latency, not the button's).
    - Lyrics empty state is a phase machine (searching → found/none) and
      `hasLyrics` now excludes `.lyrics-footer` — the component's footer
      ("Source Unavailable · am-lyrics v1.8.2") masqueraded as a
      `.lyrics-line` with text, so a failed search read as "found" and the
      cute placeholder could NEVER appear. A "SEARCHING FOR LYRICS…" pill
      shows during the fetch window (not for pinned/TTML).
26. **Lyrics texture rules + wallpaper flyout** (verified by `lyrfix.mjs`):
    - LyricsPanel takes a `metal` prop; a METAL_CHROME adopted sheet (chrome
      gradient via background-clip + silver/bright palette) replaces
      WHITE_CHROME when on. Home owns the rule:
      `metal={cdVisible && !!localLyrics && !radio.song}` — CD off and
      unpinned both force white; only pinned+disc wears metal. NOTE: the
      metal face arrives one beat after mount (localLyrics loads async from
      IDB) — a harness must poll until lines render before reading sheets.
    - The cute placeholder is permanent once shown (the phase machine holds
      'none'; the old 2–3s disappearance was the footer-as-lyrics bug).
    - WallpaperSettingsPanel: the saved-wallpapers LIST is replaced by a
      YOUR WALLPAPERS hover row → portal flyout opening to the LEFT
      (panel sits on the right edge), with CLEAR ALL (two-step) and per-item
      X deletes. The panel itself is capped (max-h + scroll) so the X stays
      in view; ADD WALLPAPER stays in the panel.
27. **Double lyrics panel fix** — user reported a second lyric layer when
    pinning. Extensive repro (pin/unpin/custom/edit/CD matrix, playing and
    non-playing tracks, shadow-tree dumps) could NOT duplicate the DOM —
    hosts stay at exactly 1. The one structural way two panels could render
    was the stage overlay and the custom frame gating on INDEPENDENT flags
    (`!lyrics.custom` vs `lyrics.custom || editLyrics`) — any desync between
    the custom flag and a lingering edit session rendered both. Now a single
    `lyricsFramed = lyrics.custom || editLyrics` gates BOTH branches, so
    double-rendering is structurally impossible. Verified: 8-state matrix
    (dupcheck7.mjs) — exactly one host everywhere. IF THE USER STILL SEES
    the double layer, suspect a stale bundle in their running instance —
    hard-reload / restart the dev server before digging further.
28. **ROOT CAUSE FOUND — the ghost lyric layer = BACKGROUND VOCALS.** The
    am-lyrics component renders `ttm:role="x-bg"` echo lines (lrc.red
    includes them for many tracks) in `.background-vocal-container`s with
    `height: 0; overflow: visible` — the 0.7em copy paints DIRECTLY over
    the neighbouring line's glyphs, entering from above or below
    (`background-before`/`-after`), character-interleaving with the real
    text. The component ALWAYS renders these containers, and the layer is
    DATA-dependent (why clean-profile repros stayed clean). Fix:
    `BG_HIDE_CHROME` in LyricsPanel — `.background-vocal-container {
    display: none !important; }` in the adopted sheet (both faces).
    Verified (dupcheck11 flow, seeded x-bg TTML): bg containers exist in
    DOM but paint nothing; main text renders once. NOTE: providers are
    FLAKY in headless (fetches often return nothing) — seed lyrics into
    IDB (`lyrics` store, key = String(track.id)) to test deterministically,
    and inject the mp3 via fetch('/src/assets/track1.mp3') — huge
    evaluate-arg arrays silently break the seed.
29. **PINNED-ONLY overlap root cause: the METAL sheet's background-clip.**
    The user's pinned+CD-on screenshots showed the lyric text painted twice
    (dim ghost at the pre-transform position). The ONLY CSS that differs
    pinned vs unpinned is the METAL_CHROME sheet, whose `background-clip:
    text` + `-webkit-text-fill-color: transparent` gradient on
    `.lyrics-line`/`.lyrics-line-container` desyncs in WebView2 from the
    line's transformed children (headless Chromium does not show it — why
    repros kept failing). Fix: METAL_CHROME rewritten WITHOUT
    background-clip — chrome palette vars (silver unsung / nickel sung via
    the component's own wipe) + an embossed shadow pair (light edge above,
    dark bevel below). Verified: metal palette applied, zero
    background-clip in our adopted sheets, bg vocals still hidden, main
    text single. ALSO fixed along the way: lyric ghost layers from x-bg
    background vocals (item 28) and overlay/frame exclusivity (item 27).
    LESSON: never paint text via background-clip:text in this app's
    WebView2 — use palette vars + shadows.
30. **Layout/styling batch** (verified by `uifix2.mjs`, all pass):
    - Custom boxes remap PROPORTIONALLY on viewport change: Home listens to
      window resize + document fullscreenchange and rescales the three saved
      boxes (lyrics CD-on/CD-off + tracklist) from the previous viewport to
      the current one, clamped — fullscreen toggles keep the panels at their
      relative spot. Boxes stay pixel-based in storage; the remap rewrites
      them (verified 1440→1800→1440 round-trip).
    - BarGraph settings grid widened to `grid-cols-[92px_1fr]` so SHOW
      BACKGROUND fits one line; labels share one x, stepper clusters share
      one x (verified).
    - Tracklist scroll frost moved from the header div to the PANEL ROOT:
      the wheel over the header tunes one level and the whole glass panel
      (header + list) goes to `blur(L)` + `rgba(255,255,255,0.05)`; level 0
      paints nothing (default `bg-black/45` glass). The header's own style
      block is gone.
31. **Pause-resume delay fixed — the keep-alive** (verified by `playcheck.mjs`):
    User report: after ~1 minute paused, PLAY took 5-6s to sound, every
    track, every time. Cause: the Windows audio endpoint powers down when
    nothing renders; waking it costs seconds on this driver stack. Fix:
    `lib/keepAlive.ts` — a looping element of one second of TRUE zero
    samples (hand-wrapped WAV, no asset), volume 0.01, started from the
    engine's watchdog effect (mount + every interaction retry, autoplay
    policy covered). Browser equivalent of foobar2000's silence-writing
    output: the endpoint never idles, so resume is instant. Plain element —
    never captured, no graph involvement, no media-session metadata.
    Harness numbers: first play 125ms, short resume 136ms, 65s-pause
    resume 220ms; keep-alive keeps rendering through every pause. The real
    endpoint proof is the user's machine (headless cannot reproduce the
    power-down itself). `keepAliveElement()` exported for the harness.
32. **Drag-reorder rewritten — pointer drag, no HTML5 DnD** (verified by
    `dragcheck.mjs` + `scrollcheck.mjs`): native HTML5 DnD stutters in
    WebView2 by construction (out-of-process ghost lags the cursor;
    dragenter throttled). PlaylistPanel now owns the drag: delegated
    `pointerdown` on the scroll box (rows carry `data-row-index`), 5px
    threshold keeps clicks clicks, then pointer capture + a rAF loop that
    writes ONE translate3d per frame to a portalled ghost
    (`.playlist-row-ghost`, fixed, pointer-events none, starts opacity 0
    until placed) while the origin row parks as the placeholder
    (`.playlist-row-drag-origin`). Landing marker + playlist chips
    (`data-chip-id`) hit-tested with elementFromPoint per frame; edge
    auto-scroll eased on the same rAF (speeds preserved ±11 × 0.25); drop
    commits via the same `onReorder(from, to)`; the click a drag ends on
    is suppressed (box capture listener, 250ms); body gets `row-dragging`
    (user-select none). The scroll window extends to cover the dragged
    slot so the row never unmounts mid-flight. TRAPS: the row entrance
    animation (`playlist-row-in`, fill both) overrides inline transforms —
    `animateIn` excludes `draggedIdx`; chips lost their native DnD
    handlers (rows no longer native-drag; chip drops ride our own state).
    Behavior, layout and tokens unchanged; only MANUAL sort + no grouping
    reorders, as before.
33. **11-item UI/logic batch** (verified by `uibatch.mjs` + `final5.mjs`):
    - IDLE CURSOR HIDING removed (Home effect + `.cursor-none` CSS gone; the
      H-key `hide-ui` cursor rule is a separate explicit feature, kept).
    - **Capture stream is RE-TAKEN on every play** (`watchDeck`): a stream
      captured from a media element is bound to the source it had when
      taken — after `src` changes the old tracks stop delivering and every
      reading is zeros ("bar graph reacts to some tracks only"). Each
      `playing`/`loadedmetadata` drops the previous MediaStreamSource and
      takes a fresh one (`deckSrcRef`). `watchingRef` is gone. The element
      is STILL never captured for real — the crossfade ramps el.volume on
      two native elements, which direct MediaElementSource capture would
      destroy (per-element gains would be a full volume-architecture
      rewrite; do not "fix" this back without reading the crossfade first).
      Verified e2e: backdrop canvas paints on track 1 AND track 2.
    - Radio: tap gets a ctx.resume() + ONE retry per URL on error
      (`radioTapRetriedRef`; `tuneRadioVizRef` because the callback cannot
      close over itself). The VISUAL toggle was already source-only
      (verified: flips `md-radio-viz`, backdrop stays). CORS-refusing
      stations are UNREADABLE by browser rule — the deck fallback freezing
      during radio is expected, not a bug.
    - Header raised z-40 → **z-[65]** (above the lyrics overlay's z-60): the
      header is ONE stacking context, so the colour picker's internal
      z-[95] was capped at 40 and lost to the lyrics.
    - WHITE_CHROME carries a hard force block: color/fill white, no
      background-clip, no text-shadow, no text-stroke (verified on a
      RENDERED pinned lyric with CD off: computed white/none/0px/none).
    - NEXT/PREV "random pick" root cause: the STANDBY (`xfArmedRef`)
      survived shuffle flips and list edits, and promoteStandby fired the
      stale pick. Armed records now carry `shuffled`; promote validates
      mode + ordered-index; the tracks-sync effect and a `[shuffle,repeat]`
      effect drop stale arms. Verified e2e incl. wrap-around.
    - HUE slider removed from TUNING (setting stays in the type).
    - CLICK DISC hint `<p>` removed (Home ~2215).
    - BarGraph card: strict `grid-cols-[1fr_auto]` + fixed `w-[104px]
      grid-cols-[24px_48px_24px]` stepper clusters (steppers align to 0px).
    - Native select popups painted dark (index.css: color-scheme dark +
      option bg #14161c; checked #2b3340) — the WebView2 popup was white-
      on-white; Butterchurn options carry ⭐ for favourites.
    - HARNESS TRAPS: `#boot.ready` is transparent + pointer-events:none but
      display stays block — dismissing by display:none never fires, just
      click once and move on. Adopted sheets throw on cssText/cssRules in
      this WebView — judge styles by getComputedStyle of rendered nodes.
      Butterchurn's factory never completes headless (no WebGL → canvas
      stuck 300x150, api never set, Overlay card absent) — its card needs
      source-level or rendered-style checks, not the live card.

---

## 6. OPEN THREADS / CAVEATS (honest state)

- **Crossfade / standby swap**: logic verified by type-check + review; the
  *audible* result needs a real listen with local tracks (3s setting). If the
  user reports a hitch at the element swap or stuck volume, start in
  `beginXfade` / `promoteStandby` / `takeoverFrom`.
- **Radio reactivity + radio VISUAL switch**: same — code paths verified, one
  real listen recommended.
- **.milk rendering**: converter output verified; shader-heavy real-world
  presets untested in-app (guide's caveats apply: unsupported HLSL throws into
  the card's error line; converted equations are `new Function` code — trust).
- **Pre-existing lint errors** (see §3.2) were deliberately left; if the user
  asks for a zero-error lint, that's a separate cleanup task.
- **dannify/data/session.json in the working tree** holds a YouTube
  visitorData token — gitignored, never commit it.
- **`graft/` graph is stale** relative to all the work above; run `graft build`
  when the CLI is reachable.
- **Demo mp3s** in `app/src/assets/track*.mp3` are unreferenced (candidates
  for removal, user's call).
- **Uncommitted work**: everything since `0b67541`. Commit in themed batches
  when the user asks.

---

## 7. HOW THE USER WORKS (match this)

- Batches of numbered items, each with explicit Acceptance Criteria — check
  them before saying done, and deliver a SHORT per-item confirmation listing
  files touched + how the criterion is met.
- "Do not redesign anything else — keep the existing layout, tokens and
  behavior intact" is a standing constraint. Hidden-not-removed when asked.
- The user verifies visually on their machine and reports back with
  screenshots; treat their repro as ground truth over your theory.
- They appreciate root-cause analysis over patch-on-patch (several fixes above
  were found by pixel-level control experiments, not by reading alone — do
  that when a cause is not provable from code reading).
