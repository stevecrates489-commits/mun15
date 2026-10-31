# MUN15H MiniDisc Player

A desktop music player styled as a luxury MiniDisc deck: a Tauri 2 shell
around a React 19 + TypeScript + Vite front end, with a vendored Python
extension (Dannify) as the online side. Every frame is meant to look like a
wallpaper — dark glass, chrome, and a spinning 3D MiniDisc.

```
aim project/
├── AGENT-HANDOFF.md            ← working context: what was changed, why, and what is open
├── 3D Music Player with CD Animation/
│   ├── app/                    ← the player (React + TS + Vite + Tauri)
│   │   ├── src/
│   │   │   ├── pages/Home.tsx            ← orchestrator; everything hangs off it
│   │   │   ├── components/               ← deck UI: DiscCase, PlaylistPanel, Transport,
│   │   │   │                                RadioPanel, LyricsPanel, CustomizePanel, …
│   │   │   ├── hooks/useAudioEngine.ts   ← THE audio engine (one element per deck,
│   │   │   │                                crossfade, standby preload, normalization)
│   │   │   ├── features/
│   │   │   │   ├── lyrics/               ← lyrics state + TTML pinning
│   │   │   │   ├── layout/               ← the layout editor's saved rectangles
│   │   │   │   ├── playlist/             ← library, ordering, system playlists
│   │   │   │   ├── radio/                ← stations, song clock, level monitor
│   │   │   │   ├── voltviz/              ← backdrop visualizers (BarGraph, Butterchurn, …)
│   │   │   │   └── dannify/              ← extension bridge sync (downloads/likes)
│   │   │   └── lib/                      ← IndexedDB library, accent, icy, theme, …
│   │   ├── src-tauri/          ← Rust shell: sources registry, MilkDrop engine, dannify bridge
│   │   ├── tests/              ← plain-node unit tests (paint, theme, songclock, visualizer)
│   │   ├── docs/               ← architecture docs (INTEGRATION_CONTRACT, ONLINE_SOURCES, …)
│   │   └── README.md           ← front-end specifics + doc index
│   ├── dannify/                ← vendored Dannify extension + the player's bridge routes
│   │   └── README.md           ← how the online side is separated
│   └── .verify/                ← Playwright UI harnesses (one per feature area)
└── .git/                       ← repo root is this folder
```

## Feature map

- **Deck** — 3D MiniDisc with reactive chrome arms, scratch interaction,
  cover/label faces, CD collection (saved disc art with a hover flyout).
- **Lyrics** — `@uimaxbai/am-lyrics` word-synced rendering; fetch from
  providers with source cycling, local pinning (TTML), an editor, sync
  offset, and two layout modes: standard (on/beside the disc) or a
  **custom position** — a draggable, resizable viewport rectangle saved per
  CD state (on/off) and remapped proportionally on resize/fullscreen.
- **Tracklist** — virtualized (windowed) rows with a smooth-scroll layer,
  sticky group headers, drag reorder, play-next queue, favourites (the
  FAVOURITES system playlist), and a scroll-driven frost over the whole
  panel. The tracklist can also take a custom saved position.
- **Radio** — station browser (radio-browser.info), ICY now-playing with a
  song clock, stream-end detection via a private CORS element, and its own
  lyrics/visual toggles.
- **Visualizers** — VoltViz backdrop styles (BarGraph, Butterchurn with
  `.milk` preset import, and more) with per-style persisted settings, plus
  a MilkDrop engine in the Rust shell.
- **Online side** — the Dannify extension in its own window; finished
  downloads sync into the reserved **Downloads Online** system playlist
  (instant via WebSocket, or one click on REFRESH).
- **Customize hub** — one panel that starts/stops layout edit sessions for
  the lyrics and tracklist, with a floating SAVE LAYOUT button; edit
  sessions are transient, the saved rectangles persist.
- **Accent from art** — dominant-color extraction drives accent CSS vars
  for the seekbar, active row, and progress lines.

## Quick start

```bash
cd "3D Music Player with CD Animation/app"
npm install
npm run tauri dev     # the real thing (Rust shell + front end)
npm run dev           # front end only, against a running Tauri shell
npm run build         # type-check + production build
```

The online side lives in `dannify/` — see its README and
`app/docs/INTEGRATION_CONTRACT.md` for how the two talk.

## Verification

- **Unit tests** (plain node, no runner):

  ```bash
  cd app
  node tests/paint.test.mjs && node tests/theme.test.mts &&
  node tests/songclock.test.mts && node tests/visualizer.test.mts
  ```

- **UI harnesses** — one Playwright script per feature area in
  `3D Music Player with CD Animation/.verify/` (`uicheck`, `lyrcheck`,
  `scrollcheck`, `uifix2`, …). Each boots the app with a Tauri shim in
  headless Edge and asserts real interactions. See
  `AGENT-HANDOFF.md` §3 for the environment quirks they encode.

## Docs worth reading

| Doc | What is in it |
| --- | --- |
| [`AGENT-HANDOFF.md`](AGENT-HANDOFF.md) | session-by-session changes, root causes, open threads, environment quirks |
| [`app/README.md`](3D%20Music%20Player%20with%20CD%20Animation/app/README.md) | front-end specifics, scripts, doc index |
| [`app/docs/INTEGRATION_CONTRACT.md`](3D%20Music%20Player%20with%20CD%20Animation/app/docs/INTEGRATION_CONTRACT.md) | the seam between the player and `dannify/` |
| [`app/docs/ONLINE_SOURCES.md`](3D%20Music%20Player%20with%20CD%20Animation/app/docs/ONLINE_SOURCES.md) | provider registry rules |
| [`dannify/README.md`](3D%20Music%20Player%20with%20CD%20Animation/dannify/README.md) | the online side's own architecture |

## Notes

- Library, playlists, lyrics, and settings persist locally (IndexedDB
  `md-walkman` + localStorage); nothing is uploaded anywhere.
- `dannify/data/` (including any session tokens) is gitignored — never
  commit it.
