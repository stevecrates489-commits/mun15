# QueuePanel (unified queue / playlists) — SPEC

> **Applies to:** `app/src/components/QueuePanel.tsx` (1923 lines) +
> `app/src/components/QueuePanel.css` (1309 lines)
>
> **Status:** v1.0 · **Read first:** [`_HouseRules.md`](_HouseRules.md)
>
> This is the app's **one unified panel** for the library side: the **play-next
> queue** and the **playlists** live in a single card behind a single tab bar.
> It replaced the old tracklist + playlist drawer. It is also the only panel
> in the app that owns a **liquid-glass lens** rather than a CSS blur.

---

## 1. Purpose

A single glass card with **two tabs**:

- **Current queue** — the play-next queue plus the playing-playlist context,
  rotated around the playhead so the track under the current row is the one
  **Next** will play.
- **My playlists** — the playlist list → a playlist's detail → per-track
  actions, plus a search across playlists, titles and artists.

It also owns the panel's own **glass** (the liquidGL lens), its **auto-hide /
pin** behaviour, the inline **track editor**, and the **add-to-queue/playlist**
menu.

---

## 2. Props (Inputs)

### 2.1 Exported types

`QueuePanel.tsx:171`

```ts
export type QueueTab = 'q' | 'p'
```

### 2.2 The exported prop interface — VERBATIM (`QueuePanel.tsx:173-215`)

```ts
export interface QueuePanelProps {
  /** whether the panel is on screen */
  open: boolean
  tab: QueueTab
  onTab: (tab: QueueTab) => void
  onRequestOpen: () => void

  tracks: Track[]
  folders: PlaylistFolder[]
  playingFolderId: number | null
  currentTrackId: number | null
  playing: boolean
  nextUp: number[]

  onPlayTrack: (trackId: number, folderId?: number) => void
  onAddToQueue: (trackId: number) => void
  onPlayNext: (trackId: number) => void
  onRemoveFromQueue: (trackId: number) => void
  onReorderQueue: (from: number, to: number) => void
  onClearQueue: () => void
  onRenameTrack: (trackId: number, title: string) => void
  onEditTrack: (trackId: number, title: string, artist: string, cover?: string) => void
  /** let Home refresh the live lyrics if the edited track is the playing one */
  onLyricsSaved: (trackId: number) => void

  onCreateFolder: () => number
  onRenameFolder: (id: number, name: string) => void
  onDeleteFolder: (id: number) => void
  onAddTrackToFolder: (folderId: number, trackId: number) => void
  onRemoveTrackFromFolder: (folderId: number, trackId: number) => void
  onReorderFolderTracks: (folderId: number, from: number, to: number) => void
  onUploadFile: (folderId: number, file: File) => void
  onRefreshDownloads: () => void
  refreshingDownloads: boolean
  refreshNote: string | null

  /** true while the panel is hosted by the layout editor's frame (the global edit mode): it fills the frame instead of docking at a screen edge */
  framed?: boolean
  /** hands the aside element to Home — the layout editor seeds its starting
     rectangle from the panel's docked position */
  outerRef?: (el: HTMLElement | null) => void
}
```

### 2.3 Supporting types (imported, must exist)

```ts
// src/hooks/useAudioEngine.ts:5
export interface Track {
  id: number
  title: string
  artist: string
  genre: string
  src: string
  cover?: string
  remote?: { contentId: string; provider: string }
}

// src/features/playlist/usePlaylists.ts:3
export interface PlaylistFolder {
  id: number
  name: string
  trackIds: number[]
  image?: string
}

export const FAVOURITES_FOLDER_ID = -1
export const FAVOURITES_FOLDER_NAME = 'FAVOURITES'
export const DOWNLOADS_FOLDER_ID = -2
export const DOWNLOADS_FOLDER_NAME = 'Downloads Online'
```

### 2.4 Prop semantics

| Prop | Meaning |
| --- | --- |
| `open` | Panel is on screen. Drives the `qp-closed` class. **In the current app Home always passes `true`** (`panelOpen` is initialised `true` and only ever set to `true`), so `qp-closed` is dead code in practice — but the class string must keep the slot. |
| `tab` / `onTab` | Which tab is active. `tab` is the **source of truth** (the panel keeps no copy). |
| `onRequestOpen` | Called from `show()` when `!open`. Effectively unreachable today. |
| `tracks` | The whole library. Drives the "Tracks" search group, the queue's library fallback context and the `Art` seeds. |
| `folders` | All playlists including the system ones. Drives the playlist list, the favourites heart state and the add-to-playlist menu. |
| `playingFolderId` | The playlist currently playing (`null` = library view). Drives folder context rows, the `· playing` marker, and folder-track reorder targets. |
| `currentTrackId` | The playing track id (or `null`). Marks the `qp-cur` row, hides that row's remove button, and pins the current track to the top of the queue. |
| `playing` | Engine playing state. Appends `· playing` to the queue header subtitle. |
| `nextUp` | The play-next queue, as **track ids**. Ordered. `nextUp[0]` is the next track. |
| `framed` | Rendered inside the layout editor's `LayoutFrame` → `.qp-framed` (position: relative, 100 % w/h, no transition). |
| `outerRef` | Receives the `<aside>` element. Home uses it to seed the layout editor's rectangle. |

### 2.5 How Home renders it — VERBATIM (`Home.tsx:1655-1689`)

```tsx
  const queuePanelEl = (
    <QueuePanel
      open={panelOpen}
      tab={queueTab}
      onTab={setQueueTab}
      onRequestOpen={qpRequestOpen}
      tracks={playlist.tracks}
      folders={playlists.folders}
      playingFolderId={selectedFolderId}
      currentTrackId={track.id >= 0 ? track.id : null}
      playing={eng.playing}
      nextUp={nextUp}
      onPlayTrack={playFromQueuePanel}
      onAddToQueue={addToNextUp}
      onPlayNext={playNextTrack}
      onRemoveFromQueue={removeFromNextUp}
      onReorderQueue={reorderNextUp}
      onClearQueue={clearNextUp}
      onRenameTrack={renameFromQueuePanel}
      onEditTrack={qpEditTrack}
      onLyricsSaved={qpLyricsSaved}
      onCreateFolder={playlists.createFolder}
      onRenameFolder={playlists.renameFolder}
      onDeleteFolder={deleteFolder}
      onAddTrackToFolder={playlists.addTrackToFolder}
      onRemoveTrackFromFolder={removeFolderTrack}
      onReorderFolderTracks={playlists.reorderTracks}
      onUploadFile={uploadToFolder}
      onRefreshDownloads={qpRefreshDownloads}
      refreshingDownloads={dannifyRefreshing}
      refreshNote={dannifyNote}
      framed={queueFramed}
      outerRef={setQueuePanelEl}
    />
  )
```

Mount site (`Home.tsx:2739-2745`):

```tsx
      {queueFramed ? (
        <LayoutFrame box={queueBox} onCommit={queueSetBox} editing={isEditingLayout} seed={queueSeed}>
          {queuePanelEl}
        </LayoutFrame>
      ) : (
        queuePanelEl
      )}
```

`queueFramed = editChrome || !!queueBox` (`Home.tsx:881`). The legacy
`PlaylistPanel` is still mounted but **hidden** (`Home.tsx:1570-1612`,
`<div hidden aria-hidden="true" className="hidden">`) — it must stay hidden,
its `aria-label="Refresh downloads"` button is what
`.verify/scrollcheck.mjs:76` actually hits.

---

## 3. State & Hooks

### 3.1 Internal state (`useState`)

| # | Variable | Type | Purpose |
|---|---|---|---|
| 1 | `glass` | `GlassPrefs = { scrim: number; blur: number; scale: number; radius: number }` | The panel's glass settings. Initialised from `readGlassPrefs()` (localStorage `md-qp-glass`). `GLASS_DEFAULT = { scrim: 0.3, blur: 3, scale: -96, radius: 28 }` (`:231`). |
| 2 | `dock` | `{ w: number; s: 'left' \| 'right' }` | Read **once** from localStorage: `md-qp-width` (clamped 300–560, default **392**) and `md-qp-side` (`'right'` → right, else left). There are **no in-panel controls** for these any more. |
| 3 | `openFolderId` | `number \| null` | Which playlist's detail view is open (playlists tab only). `null` = playlist root. |
| 4 | `query` | `string` | The search text (playlists tab only). |
| 5 | `dir` | `number` (`1` \| `-1`) | Slide direction for the body transition: `1` → `qp-slide-right`, `-1` → `qp-slide-left`. |
| 6 | `renamingId` | `number \| null` | Track id being inline-renamed. **Never set to a track id anywhere** — only ever `null` (`:498, :509, :517, :1238`). The track-level `RenameField` is therefore unreachable; only the *folder* rename is live. Keep the state and the `RenameField` branch for parity, but do not expect a rename UI on track rows. |
| 7 | `renamingFolderId` | `number \| null` | Folder id being inline-renamed. Set on **double-click of the folder name** (`:1327`). |
| 8 | `pop` | `Popover = 'glass' \| null` | Which popover is open. Only `'glass'` exists. |
| 9 | `skipped` | `{ folder: number \| null; ids: number[] }` | Track ids hidden from the **queue view only** (context rows removed from the queue but not from their playlist). Reset automatically when `playingFolderId` changes (the folder id is the key). |
| 10 | `pinned` | `boolean` | Pin the panel open (default `true`). `false` → auto-hide when the pointer leaves. |
| 11 | `away` | `boolean` | The panel is slid off-screen (auto-hidden). Drives `qp-away`. |
| 12 | `entering` | `boolean` | The panel is sliding back in; `pointer-events: none` during that window. Drives `qp-entering`. |
| 13 | `toastMsg` | `string \| null` | The toast text. Auto-clears after **1500 ms**. |
| 14 | `menu` | `{ track: Track; x: number; y: number } \| null` | The portalled add-to-queue/playlist menu. |
| 15 | `editor` | `EditorState \| null` | The track editor dialog state. |
| 16 | `lyricsOpen` | `boolean` | The `LyricsEditor` overlay is open. |
| 17 | `uploadFolderId` | `number \| null` | Which folder the hidden file input targets. |

`EditorState` (`:1085-1094`):

```ts type EditorState = {
    track: Track
    title: string
    artist: string
    lyricsTitle: string
    cover?: string
    provider: string
    source: string
    localTtml: string | null
  }
```

### 3.2 Refs (`useRef`)

| Ref | Type | Purpose |
|---|---|---|
| `panelRef` | `HTMLElement \| null` | The `<aside>`. Used for hover hit-testing, rect measurement, the liquidGL target, and the `outerRef` hand-off. |
| `listRef` | `HTMLUListElement \| null` | The current `<ul class="qp-list">`. The drag controller and the hover glider both attach to it. |
| `searchRef` | `HTMLInputElement \| null` | The search input (for the "Clear search" button's refocus). |
| `uploadRef` | `HTMLInputElement \| null` | The hidden `<input type="file" multiple>`. |
| `lgRef` | `LiquidGLHandle \| null` | The live lens handle. |
| `lgTimer` | `number` | Debounce timer for lens rebuilds. |
| `lgLastRefresh` | `number` | Timestamp of the last page re-capture (throttled to 400 ms; the reopen guard uses 6000 ms). |
| `enteringTimerRef` | `number` | Clears the `qp-entering` class after 360 ms. |
| `pinnedRef` | `boolean` | Mirror of `pinned` for the document-level pointer handlers. |
| `awayRef` | `boolean` | Mirror of `away`. |
| `hideTimerRef` | `number` | The 350 ms auto-hide grace timer. |
| `draggingRef` | `boolean` | A drag is in progress → suppresses auto-hide. |
| `rectRef` | `DOMRect \| null` | Cached panel rect (one consumer only). |
| `lastMxRef` | `number \| null` | Previous pointer X, for the dock-strip **crossing** test. |
| `toastTimerRef` | `number` | Toast auto-clear timer. |
| `cancelled` (in `RenameField`) | `boolean` | Escape pressed → don't commit on blur. |

### 3.3 Derived values (`useMemo`)

`trackById` (Map id→Track) · `favIds` (Set of FAVOURITES track ids) ·
`skippedIds` (Set, scoped to `skipped.folder === playingFolderId`) ·
`playingFolder` · `playingTracks` (folder tracks, else all library tracks) ·
`nextUpTracks` · `queueEntries` (the whole queue model — see §6.2) ·
`queuedIds` · `filteredQueue` · `folderNamesByTrack` · `folderHits` ·
`trackHits` · `openTracks` · `visibleFolderTracks`.

### 3.4 `useCallback`s

`setAside` · `setGlassPref` · `refreshGlass` · `destroyLens` · `createLens` ·
`scheduleLens` · `switchTab` · `openFolderView` · `closeFolder` · `show` ·
`hideSoon` · `togglePin` · `over` · `out` · `toast` · `toggleFav` ·
`folderTracks` · `play` · `removeOne` · `addAll` · `commitRename` ·
`startDrag`.

### 3.5 `useEffect`s

1. **Lens lifecycle** (`:413-424`) — `scheduleLens(350)` on mount; a
   `MutationObserver` on `documentElement` watching
   `attributeFilter: ['data-glass']` destroys/rebuilds the lens when the
   global Blurred/Solid switch flips.
2. **Blur/refraction rebuild** (`:427-430`) — debounced 350 ms, because
   liquidGL has no runtime setter for frost/refraction.
3. **Transparency live update** (`:433-435`) —
   `lgRef.current?.setTint?.(lgTint(glass.scrim))`.
4. **Content changed → re-capture the page behind the glass** (`:442-446`),
   400 ms debounce, deps `[tracks, folders]`.
5. **Reopen re-capture** (`:450-455`) — only if >6000 ms since the last
   capture.
6. **Framed switch** (`:461-465`) — rebuild the lens when `framed` flips (a
   lens built inside the layout frame would die with the frame).
7. **`away`/`pinned` → refs** (`:558-563`) — mirror to refs (never write a
   ref during render).
8. **Document pointerover/pointerout** (`:620-629`) — the auto-hide
   hit-testing.
9. **Rect measurement** (`:635-660`) — `ResizeObserver` + `resize` +
   `transitionend` (property `transform`), rAF-batched.
10. **Dock-edge reopen** (`:664-688`) — window `pointermove`, mouse only,
    rAF-batched.
11. **Toast cleanup** (`:698`).
12. **Hover glider** (`:998-1034`) — **no dependency array**: re-registers
    `pointerover`/`pointerleave`/`scroll` listeners on `listRef.current` on
    every render.
13. **Popover dismissal** (`:1037-1053`) — outside `pointerdown` (ignores
    `[data-qp-pop]`) and `Escape`.
14. **Track-menu dismissal** (`:1057-1073`) — outside `pointerdown` (ignores
    `[data-qp-menu]`) and `Escape`.

### 3.6 Persisted state (localStorage)

| Key | Written by | Read by | Shape |
|---|---|---|---|
| `md-qp-glass` | `setGlassPref` | `readGlassPrefs()` | `{"scrim":0.3,"blur":3,"scale":-96,"radius":28}` |
| `md-qp-width` | *(nothing writes it any more)* | `dock` init | number, 300–560, default 392 |
| `md-qp-side` | *(nothing writes it any more)* | `dock` init | `'right'` → right, else left |
| `md-glass` | PlayerSettingsPanel / PlaylistDrawer | `glassMode()` | `'off'` → solid mode |
| `md-lyrics-title:<id>` | `setLyricsTitle` | `getLyricsTitle` | lyrics-search title override |

`readGlassPrefs` clamps: `scrim` 0–0.7, `blur` 0–24, `scale` −180…−40,
`radius` 8–36. A parse failure falls back to `GLASS_DEFAULT`.

---

## 4. Event Handlers (Outputs)

### 4.1 Props the panel calls

| Callback | Fires when |
|---|---|
| `onTab(tab)` | `switchTab()` — a tab button click, an ArrowLeft/ArrowRight in the tablist, or the "Browse playlists" empty-state button. |
| `onRequestOpen()` | `show()` when `!open`. |
| `onPlayTrack(trackId, folderId?)` | `play(track, folderId)` — clicking a row's artwork button. **If the track is in the play-next queue it is removed from the queue first** (`:860`). Then `toast(\`Playing ${title}\`)`. |
| `onAddToQueue(trackId)` | The menu's "Add to queue" item; `addAll()` for every track after the first. |
| `onPlayNext(trackId)` | **Only** `addAll()` — the *first* track of the folder goes to the head of the queue, the rest are appended. There is no per-row "play next" button. |
| `onRemoveFromQueue(trackId)` | `play()` (when queued) and `removeOne()` (when queued). |
| `onReorderQueue(from, to)` | The end of a queue drag where **both** rows are queued entries — indexed by their **play-next** indices, not display indices. |
| `onClearQueue()` | The "Clear" pill in the queue bar. |
| `onRenameTrack(trackId, title)` | `commitRename()` — **currently unreachable** (see §3.1 item 6). |
| `onEditTrack(trackId, title, artist, cover?)` | `saveEditor()` — the editor's "Save" button (title trimmed; empty title aborts). |
| `onLyricsSaved(trackId)` | After the lyrics are saved or reset in `LyricsEditor`. |
| `onCreateFolder()` | The header "New playlist" button → returns the new id → the panel enters rename mode on it. |
| `onRenameFolder(id, name)` | `RenameField.onCommit` for a folder. |
| `onDeleteFolder(id)` | The folder row's trash button (not for DOWNLOADS / FAVOURITES). |
| `onAddTrackToFolder(folderId, trackId)` | The favourites heart (add), and the menu's per-playlist items. |
| `onRemoveTrackFromFolder(folderId, trackId)` | The favourites heart (remove), and the folder track row's remove button. |
| `onReorderFolderTracks(folderId, from, to)` | The end of a queue drag where **both** rows are folder-context rows and `playingFolderId != null`. |
| `onUploadFile(folderId, file)` | The hidden file input's change handler, once per picked file. |
| `onRefreshDownloads()` | The Downloads folder row's refresh button, and the "Refresh" pill in the Downloads detail bar. |

### 4.2 Internal handlers (not props)

`switchTab`, `openFolderView`, `closeFolder`, `show`, `hideSoon`,
`togglePin`, `over`, `out`, `toast`, `toggleFav`, `play`, `removeOne`,
`addAll`, `commitRename`, `startDrag`, `openTrackMenu`, `openEditor`,
`saveEditor`, `onCoverFile`, `newPlaylist`, `pickFiles`, `onFilesPicked`,
`setGlassPref`, `refreshGlass`, `destroyLens`, `createLens`, `scheduleLens`,
`setAside`.

### 4.3 Toast messages (exact strings)

`Playing ${title}` · `Removed from queue` · `${n} track(s) queued` ·
`Track renamed` · `Added to queue` · `Added to ${folder.name}` ·
`Removed from favourites` · `Added to favourites` · `Playlist created` ·
`Playlist deleted` · `Removed from playlist` · `${n} track(s) added` ·
`Queue cleared` · `Track details saved`.

---

## 5. UI structure — exhaustive

### 5.0 The panel shell

```tsx
<>
  {!open && <div className={`qp-edge${side === 'right' ? ' qp-edge-right' : ''}`} onPointerEnter={show} aria-hidden="true" />}
  <aside ref={setAside} className={...} aria-label="Queue and playlists" aria-hidden={!open && away} style={{'--qp-w': `${width}px`, '--qp-scrim': glass.scrim, '--qp-rad': `${glass.radius}px`}}>
    <div className="qp-in"> … </div>
    {editor && <div className="qp-editor" role="dialog" aria-modal="true" aria-label="Edit track"> … </div>}
  </aside>
  <input ref={uploadRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.weba" multiple hidden onChange={onFilesPicked} />
  {menu && <div className="qp-menu" data-qp-menu role="menu" style={{left: menu.x, top: menu.y}} aria-label={`Actions for ${menu.track.title}`}> … </div>}
  {lyricsOpen && editor && <LyricsEditor … />}
</>
```

Class string on the `<aside>` (`:1551-1553`) — **exact order**:

```
qp-glass qp-panel qp-side-${side} [qp-away] [qp-entering] [qp-closed] [qp-framed]
```

`.qp-edge` is `position: fixed; width: 12px; z-index: 79` at the left (or
right) — only rendered when `!open`.

### 5.1 `.qp-panel` geometry (`QueuePanel.css:31-62`)

| Property | Value |
|---|---|
| `position` | `fixed` (`.qp-framed` → `relative`, `:66-75`) |
| `z-index` | `80` |
| `left` / `top` / `bottom` | `max(16px, env(safe-area-inset-left))` / `max(56px, env(safe-area-inset-top))` / `max(16px, env(safe-area-inset-bottom))` |
| `width` | `min(var(--qp-w, 392px), calc(100vw - 32px))` |
| `height` | `min(780px, calc(100dvh - 72px))` |
| `border-radius` | `var(--qp-rad, 28px)` |
| `transition` | `transform 320ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease !important` |
| `overflow` | `hidden` (the rectangular-edge fix) |
| `isolation` | `isolate` |
| `pointer-events` | `auto !important` |

Away/closed states (`:88-100`): `translateX(calc(-100% - 40px))` (left) /
`calc(100% + 40px)` (right), `opacity: 0 !important`,
`pointer-events: none !important`.
`.qp-entering` (`:105-107`): `pointer-events: none !important`.
`.qp-panel:not(.qp-away):not(.qp-closed)` (`:117-119`): `opacity: 1 !important`
(liquidGL writes an inline `opacity: 0` during activation — this beats it).
`.qp-panel::after` (`:128-136`): `inset: 0`, `border-radius: inherit`,
`box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)`, `pointer-events: none`,
`z-index: 4`.
Solid mode `[data-glass='off'] .qp-panel.qp-glass` (`:79-81`):
`background: rgba(16, 16, 21, 0.93)`.
`.qp-panel.lg-fallback` (`:109-111`): `background: rgba(24, 24, 30, 0.42)`.
`.qp-panel[data-lg='gpu'] .qp-in::before` (`:124-126`): `background: transparent`
— the lens tint takes over the darkening.

`.qp-glass` (`:20-29`) sets the tokens:

```
--qp-tx: #ffffff;
--qp-mut: rgba(255,255,255,0.55);
--qp-pill: rgba(255,255,255,0.1);
--qp-rowh: rgba(255,255,255,0.09);
--qp-acc: #e8ecf1;      /* chrome/silver — NOT amber */
font-family: 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
```

`.qp-in` (`:141-150`): `position: relative; z-index: 3; height: 100%; display:
flex; flex-direction: column; padding: 18px 12px 8px; min-height: 0;
border-radius: inherit;`
`.qp-in::before` (`:152-160`): `inset: 0; z-index: -1; background: rgba(10, 10,
14, var(--qp-scrim, 0.3))`.
Resets: `.qp-panel *` `box-sizing: border-box` (`:162-166`); `.qp-panel button`
`font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
padding: 0` (`:168-175`); `.qp-panel ul` `list-style: none; padding: 0;
margin: 0` (`:177-181`); `.qp-panel :focus-visible` `outline: 2px solid
var(--qp-acc); outline-offset: 2px` (`:183-186`).

### 5.2 Header — `.qp-head` (`:1565-1606`)

```tsx
<header className="qp-head">
  <div>
    <h1>{title}</h1>
    <p>{sub}{playing && tab === 'q' && queueEntries.length > 0 ? ' · playing' : ''}</p>
  </div>
  <div className="qp-head-actions" data-qp-pop> … </div>
</header>
```

`title` / `sub` (`:845-855`):

| Tab | `title` (h1) | `sub` (p) |
|---|---|---|
| `q` | `Queue` | `${n} track${n===1?'':'s'}` + (` · ${nextUpTracks.length} queued` when next-up is non-empty) |
| `p`, no folder | `My playlists` | search active → `${folderHits.length} playlists · ${trackHits.length} tracks`; else `${folders.length} playlist${folders.length===1?'':'s'}` |
| `p`, folder open | the folder's name | `${visibleFolderTracks.length} track${…}` |

Header buttons (in this DOM order):

| # | Class | `aria-label` | `title` | Extra attrs | Visible when |
|---|---|---|---|---|---|
| 1 | `qp-ib` | `New playlist` | `New playlist` | — | `tab === 'p' && !openFolder` |
| 2 | `qp-ib` (+ `qp-on` when open) | `Glass settings` | `Glass settings — transparency, blur, refraction, radius` | `aria-expanded={pop === 'glass'}` | always |
| 3 | `qp-ib qp-pin` | `Keep panel open` | `Keep open` / `Auto-hide when the pointer leaves` | `aria-pressed={pinned}` | always |

**Exactly two buttons exist on the queue tab** (harnesses assert
`header.length === 2`).

CSS: `.qp-head` `:190-195` (flex, `align-items: flex-end`, `gap: 6px`,
`padding: 0 6px 0 8px`); `.qp-head > div:first-child` `flex: 1; min-width: 0`
(`:197`); `h1` `:202-211` (21px/600, `letter-spacing: -0.01em`, nowrap +
ellipsis, `line-height: 1.2`); `p` `:213-220` (12px, `--qp-mut`);
`.qp-head-actions` `:222-227` (flex, `gap: 0`, `flex: none`);
`.qp-head .qp-ib` `28px × 28px` (`:229-232`).

Icon button `.qp-ib` (`:234-242`): `32×32`, `border-radius: 10px`,
`color: var(--qp-mut)`, `transition: background .15s, color .15s`.
`.qp-ib:hover, .qp-ib.qp-on` (`:244-248`): `background: var(--qp-rowh); color:
var(--qp-tx)`.
`.qp-ib.qp-danger:hover` (`:250-253`): `background: rgba(255,90,90,0.14);
color: #ff9a9a`.
`.qp-i` (`:255-263`): `17×17`, `fill: none`, `stroke: currentColor`,
`stroke-width: 1.75`, round caps/joins.
`.qp-i[data-fill='true']` (`:265-268`): `fill: currentColor; stroke: none` —
used by the filled heart and the play triangle.
`.qp-pin svg` `rotate(45deg)`, `transition: transform .2s` (`:270-273`).
`.qp-pin[aria-pressed='true']` (`:275-282`): `color: #15130e; background:
var(--qp-acc)` → computed `rgb(232, 236, 241)`; the glyph rotates back to `0`.

### 5.3 Glass settings popover — `.qp-pop` (`:1608-1664`)

```tsx
<div className="qp-pop" role="group" aria-label="Glass settings" data-qp-pop>
  <h3>Glass settings</h3>
  … 4 ×<div className="qp-range"> …
</div>
```

Four `.qp-range` rows, in this exact order (labels are the `.qp-range > span`
texts — harnesses assert the joined string
`Transparency,Blur,Refraction,Radius`):

| # | Label text | `aria-label` | `min` | `max` | `step` | value expression | readout `<b>` |
|---|---|---|---|---|---|---|---|
| 1 | `Transparency` | `Panel transparency` | `0` | `0.7` | `0.01` | `1 - glass.scrim` | `{Math.round((1-scrim)*100)}%` |
| 2 | `Blur` | `Backdrop blur` | `0` | `24` | `1` | `glass.blur` | `{blur}px` |
| 3 | `Refraction` | `Refraction strength` | `-180` | `-40` | `4` | `glass.scale` | `{Math.abs(scale)}` |
| 4 | `Radius` | `Corner radius` | `8` | `36` | `1` | `glass.radius` | `{radius}px` |

CSS: `.qp-pop` `:286-293` (`margin: 8px 8px 0; padding: 10px 12px 12px;
border-radius: 14px;` gradient `linear-gradient(160deg, rgba(255,255,255,0.09),
rgba(255,255,255,0.03))`, `box-shadow: inset 0 1px 0 rgba(255,255,255,0.1),
0 12px 28px rgba(0,0,0,0.28)`, `flex: none`); `h3` `:295-302` (11px/600,
`letter-spacing: .08em`, uppercase, `--qp-mut`, `margin: 0 0 2px`);
`.qp-range` `:932-938` (flex, `align-items: center`, `gap: 8px`, `padding: 5px
0`, 12.5px); `.qp-range > span` `:940-944` (`flex: none; width: 76px`);
`.qp-range > b` `:946-954` (`flex: none; width: 38px; text-align: right;`
JetBrains Mono 10px, `--qp-mut`); `input[type=range]` `:956-999` (`flex: 1;
height: 18px; appearance: none`, 3px track `rgba(255,255,255,0.18)`, 12px round
thumb `--qp-tx`, hover `scale(1.15)`).

**There is NO Blurred/Solid segmented control in this popover**
(`.verify/queuefix.mjs:326-329` asserts `.qp-pop .qp-seg` does not exist).

### 5.4 The tab bar — `.qp-nav` (`:1666-1697`)

```tsx
<nav className="qp-nav" data-tab={tab} role="tablist" aria-label="Queue and playlists" onKeyDown={…}>
  <i className="qp-thumb" aria-hidden="true" />
  <button type="button" role="tab" aria-selected={tab === 'q'} tabIndex={tab === 'q' ? 0 : -1} onClick={() => switchTab('q')}>Current queue</button>
  <button type="button" role="tab" aria-selected={tab === 'p'} tabIndex={tab === 'p' ? 0 : -1} onClick={() => switchTab('p')}>My playlists</button>
</nav>
```

- Roving tabindex: the active tab is `tabIndex 0`, the other `-1`.
- Keyboard: `ArrowLeft`/`ArrowRight` toggle the tab and `preventDefault()`
  (`:1671-1676`).
- The thumb slides: `.qp-nav[data-tab='p'] .qp-thumb { transform:
  translateX(calc(100% + 4px)) }`.

CSS: `.qp-nav` `:313-322` (`position: relative; display: flex; gap: 4px;
margin: 12px 0 8px; padding: 3px; border-radius: 14px; background:
rgba(255,255,255,0.07); flex: none`); `button` `:324-334` (`position: relative;
z-index: 1; flex: 1; height: 32px; border-radius: 11px; font-size: 13px;
font-weight: 500; color: var(--qp-mut); transition: background .2s, color .2s`);
`[aria-selected='true']` `:336-338` (`color: var(--qp-tx)`); `.qp-thumb`
`:340-350` (`position: absolute; top: 3px; bottom: 3px; left: 3px; width:
calc(50% - 5px); border-radius: 11px; background: rgba(255,255,255,0.18);
box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); transition: transform .5s
cubic-bezier(.3,1.25,.35,1)`).

### 5.5 Search — `.qp-sbox` (`:1701-1733`)

**Rendered only when `tab === 'p'`.** Never on the queue tab (harnesses assert
`.qp-sbox` absent on *Current queue*).

```tsx
<div className="qp-sbox">
  <SearchIcon />
  <input ref={searchRef} type="search" value={query} placeholder="Search playlists, titles, artists" aria-label="Search" autoComplete="off" onChange={…} onKeyDown={…} />
  {query && <button type="button" className="qp-ib" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus() }}><Icon d={D.x} /></button>}
</div>
```

- `Escape` inside the search box clears it **only if it has text**
  (`:1712-1717`).
- The clear button appears only when `query` is non-empty.

CSS: `.qp-sbox` `:867-877` (`flex; align-items: center; gap: 8px; height: 36px;
margin: 0 4px 8px; padding: 0 5px 0 12px; border-radius: 12px; background:
rgba(255,255,255,0.09); flex: none`); `:focus-within` `:879-881` (`box-shadow:
0 0 0 2px rgba(232,236,241,0.55)`); `> svg` `:883-891` (15×15, stroke
`--qp-mut`, width 2); `input` `:893-903` (`flex: 1; min-width: 0; height: 100%;
background: none; border: 0; outline: 0; font-size: 13.5px`);
`::placeholder` `:905-907`; `::-webkit-search-cancel-button` `display: none`
(`:909`); `.qp-ib` inside `26×26` (`:913-917`).

### 5.6 Body / views — `.qp-body` (`:1735-1739`)

```tsx
<div className="qp-body">
  <div key={viewKey} className={`qp-slide-${dir > 0 ? 'right' : 'left'}`}>{body}</div>
</div>
```

`viewKey = \`${tab}:${openFolderId ?? 'root'}\`` — the React `key` forces a
remount on every tab/folder change so the slide animation replays.

CSS: `.qp-body` `:358-363` (`position: relative; flex: 1; min-height: 0;
overflow: hidden`); `.qp-body > div` `:365-370` (`position: absolute; inset: 0;
display: flex; flex-direction: column`); `.qp-slide-right` / `.qp-slide-left`
`:372-378` → `@keyframes qpSlideRight/qpSlideLeft` `:380-400` (`0.43s
cubic-bezier(0.32,0.72,0,1) both`, from `translateX(40%)`/`translateX(-40%)` +
`opacity: 0`).

`.qp-view` `:402-407`: `flex: 1; min-height: 0; display: flex; flex-direction:
column;`

### 5.7 Bar — `.qp-bar` (`:409-426`)

`display: flex; align-items: center; gap: 6px; padding: 0 4px 8px;
min-height: 38px; flex: none;`
`.qp-sp` = `flex: 1` spacer.
`.qp-bar > span:not(.qp-sp)` = 12.5px, `--qp-mut`, `padding-left: 6px`.

### 5.8 Pills — `.qp-pill` / `.qp-pill-sm` (`:428-509`)

`.qp-pill`: `height: 30px; padding: 0 12px; border-radius: 999px; font-size:
12.5px; font-weight: 500; background: var(--qp-pill); color: var(--qp-tx);
display: inline-flex; align-items: center; gap: 5px; transition: background
.15s; white-space: nowrap;`

`.qp-pill-sm` (`:446-461`) — the house compact affordance:
`height: 22px; padding: 0 8px; font-size: 8.5px; font-weight: 500;
letter-spacing: 0.02em; border: 1px solid rgba(255,255,255,0.1);
border-radius: 7px; gap: 4px; background: rgba(255,255,255,0.035); color:
rgba(255,255,255,0.52); box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
backdrop-filter: blur(6px); transition: background .15s, border-color .15s,
color .15s;`
`.qp-pill-sm:hover` (`:463-467`): `background: rgba(255,255,255,0.075);
border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.82)`.
`.qp-pill-sm svg` `11×11` (`:469`). `.qp-icon-pill` `padding: 0 7px` (`:507`,
wins over the earlier `0 9px` at `:493`).
`.qp-pill-primary` `background: rgba(232,236,241,0.14); color:
rgba(255,255,255,0.75)`; hover `0.24` / `#fff` (`:497-505`).

### 5.9 The list — `.qp-list` (`:520-543`)

`position: relative; flex: 1; min-height: 0; overflow-y: auto;
overscroll-behavior: contain; display: flex; flex-direction: column; gap: 4px;
padding: 2px 2px 14px; scrollbar-width: thin; scrollbar-color:
rgba(255,255,255,0.22) transparent; user-select: none;
-webkit-user-select: none;`
Webkit scrollbar `width: 8px`, thumb `rgba(255,255,255,0.22)` radius 99px.

**There is no `max-height` on the list** — it flexes to fill `.qp-body`,
which is `min(780px, 100dvh - 72px)` minus header/nav/search.

Each list starts with `<li className="qp-glider" aria-hidden="true" />`.

### 5.10 Rows — `.qp-row` (`:545-608`)

Base: `position: relative; z-index: 1; flex: none; height: 56px; display:
grid; grid-template-columns: 16px 40px 1fr auto; align-items: center; gap:
10px; padding: 0 8px 0 4px; border-radius: 14px; background: transparent;
transition: background .25s, box-shadow .25s;`

| Variant | Grid | Extra |
|---|---|---|
| `.qp-row` (queue) | `16px 40px 1fr auto` (grip, art, meta, acts) | `padding: 0 8px 0 4px` |
| `.qp-row.qp-t` (track) | `40px 1fr auto` | `padding-left: 8px` (`:564-568`) |
| `.qp-row.qp-pl` (folder) | `40px 1fr auto auto` | `cursor: pointer` (`:570-573`) |

> The `qp-t`/`qp-pl` 3-column override exists because the empty grip
> placeholder is still a child — a 3-column template on a 4-child row would
> push the meta into the acts column (the right-aligned-text bug the harnesses
> guard against).

**Row state machine**

| State | Selector | Style |
|---|---|---|
| Rest | `.qp-row` | transparent background, no shadow |
| Hover / focus-within | `.qp-row:hover` / `:focus-within` | `.qp-meta b` → `rgba(255,255,255,1)` (`:706-709`); `.qp-acts`/`.qp-folder-acts`/`.qp-grip` → `opacity: 1` (`:771-786`, `:823-827`) |
| Current track | `.qp-row.qp-cur` | `background: rgba(255,255,255,0.09); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)`; `b` → `#fff` (`:593-600`). Fades in over 0.25s, **no** movement/marker/glow. |
| Dragging | `.qp-row.qp-lift` | `z-index: 5; background: rgba(60,60,68,0.78); box-shadow: 0 12px 30px rgba(0,0,0,0.45); transition: none; cursor: grabbing` (`:602-608`) |
| Touch devices | `@media (hover: none)` (`:1295-1301`) | `.qp-acts, .qp-folder-acts, .qp-grip { opacity: 1 }` |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` (`:1303-1309`) | `.qp-panel, .qp-panel * { transition: none !important; animation: none !important }` |

### 5.11 The hover glider — `.qp-glider` (`:575-588`)

`position: absolute; left: 2px; right: 2px; top: 0; height: 56px;
border-radius: 14px; background: rgba(255,255,255,0.12); box-shadow: inset 0 0
0 1px rgba(255,255,255,0.1); opacity: 0; pointer-events: none; transition:
opacity .18s, transform .18s cubic-bezier(.2,.8,.2,1); z-index: 0;`

It is moved by JS: `glider.style.transform = \`translateY(${row.offsetTop}px)\``
on `pointerover` of a `.qp-row`; hidden (`opacity: 0`) on `pointerleave` and on
`scroll`.

### 5.12 Artwork — `.qp-art` (`:612-676`)

`position: relative; width: 40px; height: 40px; border-radius: 10px;
display: grid; place-items: center; overflow: hidden; background:
linear-gradient(135deg, hsl(var(--qp-h,30) 52% 44%), hsl(calc(var(--qp-h,30) +
40) 58% 22%)); font-weight: 600; font-size: 16px; color: rgba(255,255,255,0.85);
text-shadow: 0 1px 2px rgba(0,0,0,0.3); flex: none;`

- `--qp-h` comes from `hueFor(seed)` = `(seedSum * 47 + 12) % 360` (string seed
  → sum of char codes).
- With a cover: `<img src draggable={false} alt="" />` filling the box
  (`object-fit: cover`).
- Without: the first letter of the title, upper-cased, or `?`.
- As a `<button>`: `aria-label` = `Play ${title}` (or the `label` prop), a
  `::after` scrim `rgba(0,0,0,0.45)` fading to `opacity: 1` on
  `:hover`/`:focus-visible` (`:645-658`), and a centred 16×16 white play
  triangle `.qp-art-play` that fades in the same way (`:660-676`).
- As a `<span>` (folder rows): no overlay, no play glyph.

### 5.13 Meta — `.qp-meta` (`:680-738`)

`min-width: 0; line-height: 1.25; text-align: left; justify-self: start;
width: 100%;`
`b`/`i` are `display: block; white-space: nowrap; overflow: hidden;
text-overflow: ellipsis;`

- `b` (title): `font-size: 14px; font-weight: 600; letter-spacing: 0.025em;
  color: rgba(255,255,255,0.8); transition: color .15s;`
- `i` (artist): `font-family: 'JetBrains Mono', monospace; font-size: 10px;
  letter-spacing: 0.1em; font-style: normal; color: rgba(255,255,255,0.4);
  margin-top: 2px;`

**The fade masks (load-bearing):**

```css
.qp-row .qp-meta {                       /* queue rows: 2 icons */
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 96px), transparent calc(100% - 46px));
  mask-image: linear-gradient(90deg, #000 calc(100% - 96px), transparent calc(100% - 46px));
}
.qp-row.qp-t .qp-meta {                  /* playlist rows: 4 icons */
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 132px), transparent calc(100% - 116px));
  mask-image: linear-gradient(90deg, #000 calc(100% - 132px), transparent calc(100% - 116px));
}
.qp-meta:has(.qp-rn) { mask-image: none !important; }   /* rename field: no mask */
```

> Note: `.verify/nextprev.mjs:317` asserts the mask contains **`108px`** —
> that harness is **stale** (the CSS now says 96px).
> `.verify/polishcheck.mjs:122` asserts `calc(100% - 132px)` on `.qp-row.qp-t`
> — that one matches.

### 5.14 Row actions — `.qp-acts` / `.qp-folder-acts` (`:745-786`)

`.qp-acts`: `position: absolute; right: 6px; top: 0; bottom: 0; display: flex;
align-items: center; gap: 1px; opacity: 0; transition: opacity .15s;`
`.qp-folder-acts`: `display: flex; align-items: center; opacity: 0;
transition: opacity .15s;` (in flow, so it holds the 3rd grid column).

Buttons inside: `26 × 26`; glyphs: `13 × 13` (`:759-769`). Both fade to
`opacity: 1` on `.qp-row:hover` / `.qp-row:focus-within`.

`.qp-ib.qp-fav` (`:741-743`): `color: #a82e2e` (solid dark red when armed).

`.qp-chev` (`:788-797`): `16×16`, `fill: none`, `stroke: var(--qp-mut)`,
`stroke-width: 2`, `transform: rotate(180deg)` — the folder row's chevron.

### 5.15 The grip — `.qp-grip` (`:801-827`)

`display: grid; place-items: center; width: 16px; height: 40px; color:
var(--qp-mut); cursor: grab; opacity: 0; touch-action: none; transition:
opacity .15s;`
`.qp-grip.qp-grip-empty` → `pointer-events: none`.
`.qp-grip svg` → `12×12`, `fill: currentColor` (six dots).
Visible on `.qp-row:hover`, `:focus-within`, `.qp-lift`.

### 5.16 Empty states — `.qp-empty` (`:831-847`)

`flex: 1; display: flex; flex-direction: column; gap: 12px; align-items: center;
justify-content: center; color: var(--qp-mut); font-size: 14px; text-align:
center; padding: 0 20px;`
`.qp-hint` → `font-size: 12px; opacity: 0.7`.

### 5.17 Rename field — `.qp-rn` (`:851-863`)

`width: 100%; font: inherit; font-size: 14px; font-weight: 500; color:
var(--qp-tx); background: rgba(255,255,255,0.12); border: 0; border-radius: 7px;
padding: 3px 7px; outline: 2px solid var(--qp-acc); user-select: text;`

### 5.18 Section label — `.qp-lbl` (`:919-927`)

`flex: none; padding: 8px 8px 2px; font-size: 11px; font-weight: 600;
letter-spacing: 0.07em; text-transform: uppercase; color: var(--qp-mut);`

### 5.19 Toast — `.qp-toast` (`:1262-1283`)

`position: absolute; z-index: 6; left: 50%; bottom: 18px; transform:
translate(-50%, 12px); padding: 8px 14px; border-radius: 999px; font-size:
12.5px; font-weight: 500; background: rgba(20,20,24,0.82); box-shadow: 0 0 0
1px rgba(255,255,255,0.12); opacity: 0; pointer-events: none; transition:
opacity .2s, transform .2s; white-space: nowrap;`
`.qp-toast.qp-show` → `opacity: 1; transform: translate(-50%, 0)`.
Rendered as `<div className={...} role="status" aria-live="polite">{toastMsg}</div>`
— **always in the DOM**.

### 5.20 The track editor — `.qp-editor` (`:1746-1830`)

```tsx
<div className="qp-editor" role="dialog" aria-modal="true" aria-label="Edit track">
  <div className="qp-editor-card">
    <div className="qp-editor-head"><b>Edit track</b><button className="qp-ib" aria-label="Close editor" …><Icon d={D.x}/></button></div>
    <label className="qp-field"><span>Title</span><input …/></label>
    <label className="qp-field"><span>Artist</span><input …/></label>
    <label className="qp-field"><span>Title used for lyrics</span><input placeholder={editor.title} …/></label>
    <div className="qp-source"><span>Lyrics source</span><b>{…}</b></div>
    <div className="qp-poster">
      <div className="qp-poster-img">{cover ? <img/> : <span>{first letter}</span>}</div>
      <div className="qp-poster-btns">
        <label className="qp-filebtn"><Icon d={D.image}/>{cover ? 'Replace poster' : 'Add poster'}<input type="file" accept="image/*" onChange={onCoverFile}/></label>
        {cover && <button className="qp-filebtn qp-filebtn-danger"><Icon d={D.trash}/>Remove</button>}
      </div>
    </div>
    <div className="qp-editor-actions">
      <button className="qp-pill qp-pill-sm" onClick={() => setLyricsOpen(true)}><Icon d={D.lyrics}/>{localTtml ? 'Edit lyrics' : 'Add lyrics'}</button>
      <span className="qp-sp"/>
      <button className="qp-pill qp-pill-sm" onClick={() => setEditor(null)}>Cancel</button>
      <button className="qp-pill qp-pill-sm qp-pill-primary" onClick={saveEditor}><Icon d={D.check}/>Save</button>
    </div>
  </div>
</div>
```

`Lyrics source` value: `editor.localTtml ? (source === 'custom' ? 'Custom ·
saved locally' : source) : editor.provider`; `editor.provider` is
`${provider.short} · ${provider.label}` or `'Auto provider chain'`.

CSS: `.qp-editor` `:1003-1014` (`position: absolute; inset: 0; z-index: 12;
display: grid; place-items: center; padding: 14px; background:
rgba(6,7,10,0.62); backdrop-filter: blur(10px); border-radius: inherit`);
`.qp-editor-card` `:1016-1025` (`width: 100%; max-height: 100%; overflow-y:
auto; border-radius: 18px; padding: 14px;` gradient `linear-gradient(165deg,
rgba(40,40,48,0.98), rgba(14,14,18,0.98))`); `.qp-editor-head` `:1027-1034`;
`.qp-field` `:1036-1049`; `.qp-field input` `:1051-1066` (`height: 32px;
border-radius: 9px; background: rgba(255,255,255,0.08)`; focus `box-shadow:
0 0 0 2px rgba(232,236,241,0.5)`); `.qp-source` `:1068-1085` (`b { color:
#9fe8ff }`); `.qp-poster` `:1087-1120`; `.qp-poster-img` `:1094-1113`
(`62×62`); `.qp-filebtn` `:1122-1150` (`min-height: 22px; border-radius: 7px;
font-size: 8.5px`); `.qp-filebtn-danger` `:1156-1164`; `.qp-editor-actions`
`:1166-1178` (`border-top: 1px solid rgba(255,255,255,0.06)`; its
`.qp-pill-sm` is `height: 23px; padding: 0 9px`).

### 5.21 The add-to menu — `.qp-menu` (`:1842-1886`) — **rendered OUTSIDE the `<aside>`**

```tsx
<div className="qp-menu" data-qp-menu role="menu" style={{left: menu.x, top: menu.y}} aria-label={`Actions for ${menu.track.title}`}>
  <button type="button" role="menuitem" onClick={…}><Icon d={D.list}/>Add to queue</button>
  <div className="qp-menu-lbl">Add to playlist</div>
  <div className="qp-menu-scroll">
    {noFolders && <span className="qp-menu-empty">No playlists yet</span>}
    {folders.filter(f => f.id !== DOWNLOADS_FOLDER_ID).map(f => (
      <button key={f.id} type="button" role="menuitem" onClick={…}><Icon d={D.plus}/>{f.name}</button>
    ))}
  </div>
</div>
```

Position (`:1075-1082`): `x = Math.max(8, Math.min(rect.right - 216,
window.innerWidth - 224))`, `y = Math.min(rect.bottom + 4, window.innerHeight -
240)`.

CSS: `.qp-menu` `:1182-1195` (`position: fixed; z-index: 120; width: 216px;
max-height: min(60vh, 300px); display: flex; flex-direction: column; padding:
5px; border-radius: 12px; background: #101014; box-shadow: inset 0 0 0 1px
rgba(255,255,255,0.1), 0 20px 50px rgba(0,0,0,0.7); font-family: 'Space
Grotesk', …; color: #f5f2ec`); `> button` `:1197-1212` (`padding: 8px;
border-radius: 8px; font-size: 12px`; hover `rgba(255,255,255,0.1)`); `svg`
13×13 (`:1214`); `.qp-menu-lbl` `:1221-1228` (`font-size: 9px; letter-spacing:
.09em; uppercase`); `.qp-menu-scroll` `:1230-1234` (`min-height: 0; overflow-y:
auto; scrollbar-width: thin`); its buttons `:1236-1251` (`padding: 7px 8px`);
`.qp-menu-empty` `:1253-1257`.

### 5.22 The liquidGL lens

Not CSS, but part of the visual contract:

```ts
const lens = liquidGL('.qp-panel', {
  engine: 'auto', snapshot: 'body',
  refraction: lgRefraction(p.scale),   // min(0.09, |scale|/180 * 0.09)
  bevelDepth: 0.13, bevelWidth: 0.1,
  frost: p.blur,
  tint: lgTint(p.scrim),               // `rgba(10, 10, 14, ${scrim})`
  shadow: false, specular: true, reveal: 'none',
  on: { init: () => { el.dataset.lg = 'gpu'; refreshGlass() } },
})
```

Then `el.dataset.lg = 'css'` if no `<canvas>` was produced;
`el.dataset.lgFrost = String(p.blur)`;
`el.dataset.lgRefraction = String(lgRefraction(p.scale))`.
`destroyLens()` does `delete el.dataset.lg`.

---

## 6. The two tabs (queue / playlists)

### 6.1 The switch mechanism

`switchTab(next)` (`:491-503`):

```ts
  const switchTab = useCallback(
    (next: QueueTab) => {
      if (next === tab && openFolderId == null) return
      setDir(next === tab ? -1 : next === 'p' ? 1 : -1)
      onTab(next)
      setOpenFolderId(null)
      setQuery('')
      setRenamingId(null)
      setRenamingFolderId(null)
      setPop(null)
    },
    [tab, openFolderId, onTab],
  )
```

- Clicking the *same* tab while a folder is open → closes the folder (returns
  to the playlist root) and slides **left**.
- Switching to `p` → `dir = 1` (slide **right**). Switching to `q` → `dir = -1`
  (slide **left**).
- Every switch resets: open folder, search query, both rename states, and the
  glass popover.
- `openFolderView(id)` (`:505-511`): `dir = 1`, opens the folder, clears query
  + renames.
- `closeFolder()` (`:513-519`): `dir = -1`, clears query + renames.

`viewKey` (`:489`) = `${tab}:${openFolderId ?? 'root'}` — the body wrapper's
React key, so switching remounts the body and replays the slide animation.

### 6.2 The QUEUE tab

**Bar** (`:1389-1403`): a `.qp-sp` spacer and, **only when
`nextUpTracks.length > 0`**, a `qp-pill qp-pill-sm` button labelled
**`Clear`** → `onClearQueue()` + toast `Queue cleared`.

**List** (`:1404-1408`):

```tsx
<ul className="qp-list" ref={listRef}>
  <li className="qp-glider" aria-hidden="true" />
  {filteredQueue.map((entry, i) => queueRow(entry, i))}
</ul>
```

**Empty** (`:1409-1418`):

```tsx
<div className="qp-empty">
  {q ? `No matches for “${query}”` : 'Nothing queued'}
  {!q && <button type="button" className="qp-pill qp-pill-sm" onClick={() => switchTab('p')}>Browse playlists</button>}
</div>
```

#### The queue row (`queueRow`, `:1165-1223`) — VERBATIM

```tsx
  const queueRow = (entry: QueueEntry, index: number) => {
    const { track } = entry
    const canDrag = !q && (entry.nextUpIndex >= 0 || entry.folderIndex >= 0)
    const queued = entry.nextUpIndex >= 0
    return (
      <li
        key={entry.key}
        className={`qp-row${track.id === currentTrackId ? ' qp-cur' : ''}`}
        data-qidx={index}
        data-queued={queued ? 'true' : 'false'}
        tabIndex={0}
      >
        {canDrag ? (
          <span
            className="qp-grip"
            title="Drag to reorder"
            aria-hidden="true"
            onPointerDown={(e) => startDrag(e, index)}
          >
            <GripIcon />
          </span>
        ) : (
          <span className="qp-grip qp-grip-empty" aria-hidden="true" />
        )}
        <Art
          title={track.title}
          cover={track.cover}
          seed={track.id}
          onPlay={() => play(track, playingFolderId ?? undefined)}
        />
        <div className="qp-meta">
          <b>{track.title}</b>
          <i>{track.artist}</i>
        </div>
        <span className="qp-acts">
          <button
            type="button"
            className="qp-ib"
            aria-label={`Edit ${track.title}`}
            title="Edit track"
            onClick={() => openEditor(track)}
          >
            <Icon d={D.pen} />
          </button>
          {track.id !== currentTrackId && (
            <button
              type="button"
              className="qp-ib"
              aria-label={`Remove ${track.title} from the queue`}
              title="Remove from queue"
              onClick={() => removeOne(track)}
            >
              <Icon d={D.x} />
            </button>
          )}
        </span>
      </li>
    )
  }
```

**Queue rows carry NO heart** (`.verify/polishcheck.mjs:123-129` asserts
`button[aria-label*="favourites"]` is absent from `.qp-row[data-qidx]`).

#### The queue model — `queueEntries` (`:752-796`) — the heart of the tab

```ts
  const queueEntries = useMemo<QueueEntry[]>(() => {
    const out: QueueEntry[] = []
    const seen = new Set<number>()
    if (current) {
      out.push({
        key: `cur:${current.id}`,
        track: current,
        nextUpIndex: nextUpTracks.findIndex((t) => t.id === current.id),
        folderIndex: playingFolderId != null ? playingTracks.findIndex((t) => t.id === current.id) : -1,
      })
      seen.add(current.id)
    }
    nextUpTracks.forEach((t, i) => { … out.push({ key: `next:${t.id}`, track: t, nextUpIndex: i, folderIndex: -1 }) })
    const at = current ? playingTracks.findIndex((t) => t.id === current.id) : -1
    const ahead = at === -1 ? playingTracks : [...playingTracks.slice(at + 1), ...playingTracks.slice(0, at)]
    …
    return out.filter((e) => !skippedIds.has(e.track.id))
  }, [current, nextUpTracks, playingTracks, playingFolderId, skippedIds])
```

Order: **current track first** → **the play-next queue** → **the
playing-playlist context, rotated so that the row under the current row is the
track Next will play** (already-played tracks sink below the upcoming ones).
`folderIndex` stays the index *inside the folder's own list*, not the rotated
display slot.

`QueueEntry` (`:217-224`):

```ts
type QueueEntry = {
  key: string
  track: Track
  /** index in Home's play-next queue, -1 when the row is just context */
  nextUpIndex: number
  /** index in the playing folder, -1 when it is the current track */
  folderIndex: number
}
```

#### Play / remove

`play(track, folderId?)` (`:858-865`):

```ts
    (track: Track, folderId?: number) => {
      if (queuedIds.has(track.id)) onRemoveFromQueue(track.id)
      onPlayTrack(track.id, folderId)
      toast(`Playing ${track.title}`)
    },
```

`removeOne(track)` (`:867-884`):

```ts
      if (queuedIds.has(track.id)) onRemoveFromQueue(track.id)
      else
        setSkipped((prev) => {
          const ids = prev.folder === playingFolderId ? prev.ids : []
          return { folder: playingFolderId, ids: ids.includes(track.id) ? ids : [...ids, track.id] }
        })
      toast('Removed from queue')
```

> A play-next row is really in Home's queue → removed from it. A folder-context
> row is only in the queue **view** → hidden locally via `skipped`, never
> deleted from the playlist.

### 6.3 The PLAYLISTS tab — root (no folder open) (`:1423-1491`)

**Bar**: only rendered when **not** searching (`{q ? null : (<div
className="qp-bar"><span className="qp-sp"/><span>{folders.length} playlists</span></div>)}`).

**List**: one `<ul className="qp-list" ref={listRef}>` with the glider, then
two optional groups:

1. `<li className="qp-lbl">My playlists</li>` followed by the folder rows.
2. `<li className="qp-lbl">Tracks</li>` followed by the search-hit track rows
   (`qp-row qp-t` with `data-i`).

**Empty**: `<div className="qp-empty">No matches for “{query}”</div>` — note
this renders even with an **empty** query when there are no folders at all (a
quirk; keep or fix deliberately).

#### The folder row (`folderRow`, `:1294-1381`) — VERBATIM

```tsx
  const folderRow = (folder: PlaylistFolder) => {
    const first = folder.trackIds.length ? trackById.get(folder.trackIds[0]) : undefined
    const isDownloadsFolder = folder.id === DOWNLOADS_FOLDER_ID
    const deletable = folder.id !== DOWNLOADS_FOLDER_ID && folder.id !== FAVOURITES_FOLDER_ID
    return (
      <li
        key={folder.id}
        className="qp-row qp-pl"
        data-open={folder.id}
        tabIndex={0}
        onClick={() => openFolderView(folder.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openFolderView(folder.id)
          }
        }}
      >
        <Art
          title={folder.name}
          cover={folder.image ?? first?.cover}
          seed={first?.id ?? folder.name}
          label={`Open ${folder.name}`}
        />
        <div className="qp-meta">
          {renamingFolderId === folder.id ? (
            <RenameField
              initial={folder.name}
              onCommit={(value) => onRenameFolder(folder.id, value)}
              onCancel={() => setRenamingFolderId(null)}
            />
          ) : (
            <>
              <b onDoubleClick={() => setRenamingFolderId(folder.id)}>{folder.name}</b>
              <i>
                {folder.trackIds.length} track{folder.trackIds.length === 1 ? '' : 's'}
                {folder.id === playingFolderId ? ' · playing' : ''}
              </i>
            </>
          )}
        </div>
        <span className="qp-folder-acts">
          {isDownloadsFolder && (
            <button
              type="button"
              className="qp-ib"
              aria-label="Refresh Downloads Online"
              title="Refresh downloads"
              onClick={(e) => { e.stopPropagation(); onRefreshDownloads() }}
            >
              <Icon d={D.refresh} className={`qp-i${refreshingDownloads ? ' qp-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            className="qp-ib"
            aria-label={`Add files to ${folder.name}`}
            title="Add files to this playlist"
            onClick={(e) => { e.stopPropagation(); pickFiles(folder.id) }}
          >
            <Icon d={D.plus} />
          </button>
          {deletable && (
            <button
              type="button"
              className="qp-ib qp-danger"
              aria-label={`Delete ${folder.name}`}
              title="Delete playlist"
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); toast('Playlist deleted') }}
            >
              <Icon d={D.trash} />
            </button>
          )}
        </span>
        <Icon d={D.back} className="qp-chev" />
      </li>
    )
  }
```

- The folder artwork is a **`<span>`** (no `onPlay`) — so it is **not** a
  button and carries **no** `aria-label`; the `label` prop is unused there.
- `data-open={folder.id}` — the harness `.verify/polishcheck.mjs:112` clicks
  `[data-open="100"]`.
- The chevron is a rotated back-arrow (`rotate(180deg)`), i.e. "enter".
- `qp-pl` rows are keyboard-activatable with `Enter` or `Space`.
- Every action button calls `e.stopPropagation()` so the row doesn't open.

#### The search-hit track row (`:1444-1482`)

`className="qp-row qp-t"`, `data-i={t.id}`, `tabIndex={0}`. Art plays the track
(`play(t, playingFolderId ?? undefined)`). Meta shows `title` and `artist ·
playlistName, playlistName` (from `folderNamesByTrack`). Actions: **Edit**
(`aria-label={`Edit ${t.title}`}`, `title="Edit track"`) and **Add to queue or
playlist** (`aria-label={`Add ${t.title} to queue or playlist`}`, `title="Add
to queue or playlist"`). **No heart** on these rows (unlike `trackRow` below).

### 6.4 The PLAYLISTS tab — folder detail (`:1493-1535`)

**Bar**, in DOM order:

| Order | Class | Label | Visible when | Action |
|---|---|---|---|---|
| 1 | `qp-pill qp-pill-sm` | `<Icon d={D.back}/> Playlists` | always | `closeFolder()` |
| — | `qp-sp` | spacer | always | — |
| 2 | `qp-pill qp-pill-sm qp-icon-pill` | `<Icon refresh/> {refreshingDownloads ? 'Refreshing' : 'Refresh'}` | `isDownloads` | `onRefreshDownloads()` |
| 3 | `qp-pill qp-pill-sm` | `Add all` | `openTracks.length > 0` | `addAll()` |
| 4 | `qp-pill qp-pill-sm qp-icon-pill` | `<Icon plus/> Files` | always | `pickFiles(openFolder.id)` |

**Note** (`:1522`): `{refreshNote && isDownloads && <div className="qp-note">{refreshNote}</div>}`
— a small 11px `--qp-acc` line under the bar. The note text comes from Home
(`+N ADDED` / `UP TO DATE`) and auto-clears after 2500 ms in Home.

**List**: `<ul className="qp-list" ref={listRef}>` + glider +
`visibleFolderTracks.map(t => trackRow(t, openFolder.id, openFolder.id !==
DOWNLOADS_FOLDER_ID))`.

**Empty** (`:1528-1533`):

```tsx
<div className="qp-empty">
  {q ? `No matches for “${query}”` : 'No tracks yet'}
  {!q && <span className="qp-hint">Use FILES to add music to this playlist</span>}
</div>
```

#### The track row (`trackRow`, `:1225-1292`) — VERBATIM

```tsx
  const trackRow = (track: Track, folderId: number, allowRemove: boolean) => (
    <li key={track.id} className="qp-row qp-t" data-i={track.id} tabIndex={0}>
      <Art
        title={track.title}
        cover={track.cover}
        seed={track.id}
        onPlay={() => play(track, folderId)}
      />
      <div className="qp-meta">
        {renamingId === track.id ? (
          <RenameField
            initial={track.title}
            onCommit={(value) => commitRename(track, value)}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <>
            <b>{track.title}</b>
            <i>{track.artist}</i>
          </>
        )}
      </div>
      <span className="qp-acts">
        <button
          type="button"
          className={`qp-ib${favIds.has(track.id) ? ' qp-fav' : ''}`}
          aria-label={favIds.has(track.id) ? `Remove ${track.title} from favourites` : `Add ${track.title} to favourites`}
          aria-pressed={favIds.has(track.id)}
          title={favIds.has(track.id) ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => toggleFav(track)}
        >
          <Icon d={D.heart} filled={favIds.has(track.id)} />
        </button>
        <button
          type="button"
          className="qp-ib"
          aria-label={`Edit ${track.title}`}
          title="Edit track"
          onClick={() => openEditor(track)}
        >
          <Icon d={D.pen} />
        </button>
        <button
          type="button"
          className="qp-ib"
          aria-label={`Add ${track.title} to queue or playlist`}
          title="Add to queue or playlist"
          onClick={(e) => openTrackMenu(track, e.currentTarget)}
        >
          <Icon d={D.plus} />
        </button>
        {allowRemove && (
          <button
            type="button"
            className="qp-ib"
            aria-label={`Remove ${track.title} from playlist`}
            title="Remove from playlist"
            onClick={() => {
              onRemoveTrackFromFolder(folderId, track.id)
              toast('Removed from playlist')
            }}
          >
            <Icon d={D.x} />
          </button>
        )}
      </span>
    </li>
  )
```

`allowRemove` is `openFolder.id !== DOWNLOADS_FOLDER_ID` → **the Downloads
Online playlist's tracks have no remove button**.

### 6.5 The play-next queue ("Add to queue", "play next", "x to remove")

- **"Add to queue"** — only in the `+` menu (`qp-menu` first item) and in
  `addAll()`. `onAddToQueue(trackId)`.
- **"play next"** — there is **no per-row "play next" control**.
  `onPlayNext` is called only by `addAll()` (`:886-893`), which puts the
  *first* track at the head of the queue and appends the rest:

```ts
  const addAll = useCallback(() => {
    if (!openFolder) return
    const ids = folderTracks(openFolder).map((t) => t.id)
    if (!ids.length) return
    onPlayNext(ids[0])
    ids.slice(1).forEach((id) => onAddToQueue(id))
    toast(`${ids.length} track${ids.length === 1 ? '' : 's'} queued`)
  }, [openFolder, folderTracks, onPlayNext, onAddToQueue, toast])
```

- **"x to remove"** — the queue row's `Remove ${title} from the queue` button
  (hidden on the current track) and, inside a folder, `Remove ${title} from
  playlist`.
- The `Clear` pill empties the whole play-next queue.

### 6.6 Playlist create / rename / delete / add-track / remove-track

| Flow | Mechanism |
|---|---|
| **Create** | Header `+` (`aria-label="New playlist"`) → `newPlaylist()` (`:1143-1148`): `const id = onCreateFolder(); setRenamingFolderId(id); setQuery(''); toast('Playlist created')`. `onCreateFolder()` **returns the new id** and the panel immediately opens the inline rename field on it. Home's `playlists.createFolder` names it `Playlist 01`, `Playlist 02`, … |
| **Rename** | **Double-click the folder name** (`<b onDoubleClick>`) → `RenameField` replaces the meta block. `RenameField` (`:123-167`) autofocuses + selects, `maxLength={80}`, commits on blur if the trimmed value is non-empty and different from the original, `Enter` blurs (commits), `Escape` sets `cancelled = true` and blurs (no commit), and `onPointerDown`/`onClick` stop propagation so the row does not open. `aria-label="Rename"`. |
| **Delete** | The folder row's trash button (`qp-ib qp-danger`, `aria-label={`Delete ${folder.name}`}`, `title="Delete playlist"`) → `onDeleteFolder(id)` + toast `Playlist deleted`. |
| **Add a track** | The track row's `+` → the menu → a per-playlist button → `onAddTrackToFolder(folderId, track.id)` + toast `Added to ${folder.name}`. Or the heart → FAVOURITES. |
| **Remove a track** | The track row's `x` (hidden in Downloads Online) → `onRemoveTrackFromFolder(folderId, track.id)` + toast `Removed from playlist`. |
| **Upload** | The folder row's `+` (`Add files to ${folder.name}`) or the detail bar's `Files` pill → `pickFiles(folderId)` → `uploadRef.current?.click()`. The hidden input has `multiple`; each file calls `onUploadFile(folderId, file)`; a toast reports `${n} track(s) added`. |
| **Add all** | The detail bar's `Add all` pill → `addAll()` (see §6.5). |

### 6.7 The system playlists

`DOWNLOADS_FOLDER_ID = -2` (`Downloads Online`) and `FAVOURITES_FOLDER_ID = -1`
(`FAVOURITES`).

| Rule | Where |
|---|---|
| Downloads Online exists from first launch and is recreated if missing | `usePlaylists.ts:56-59` `ensureDownloads()` |
| **Un-deletable** | UI: `deletable = folder.id !== DOWNLOADS_FOLDER_ID && folder.id !== FAVOURITES_FOLDER_ID` → **no trash button**. Backstop: `usePlaylists.ts:128-134` `deleteFolder` returns early for `DOWNLOADS_FOLDER_ID`. |
| Marked undeletable by | **absence of the delete button** — there is no "locked" badge, no `aria-disabled`, no `data-` flag. The only visual difference is the missing trash icon. |
| The Downloads folder row is the only one with a **Refresh** button | `isDownloadsFolder` (`:1296`, `:1336-1349`) — `aria-label="Refresh Downloads Online"`, `title="Refresh downloads"`, glyph spins via `.qp-spin` while `refreshingDownloads`. |
| Tracks inside Downloads Online have **no remove button** | `allowRemove = openFolder.id !== DOWNLOADS_FOLDER_ID` (`:1526`) |
| Downloads Online is **excluded from the add-to-playlist menu** | `folders.filter(f => f.id !== DOWNLOADS_FOLDER_ID)` (`:1864`, `:1868`) — harness `.verify/queuefix.mjs:258-263` asserts the menu lists `FAVOURITES` and `Road 66` but **never** `Downloads Online`. |
| FAVOURITES **is** listed in the menu | only the Downloads folder is filtered out. |
| FAVOURITES is created on the first star | `usePlaylists.ts:138-150` `toggleFavourite` |
| FAVOURITES rows carry the `· playing` marker when it is the playing folder | `folder.id === playingFolderId ? ' · playing' : ''` |

---

## 7. Drag & drop — EXHAUSTIVE

### 7.1 Mechanism

**Raw pointer events on the grip handle. No library, no HTML5 DnD.**

- The grip is a `<span className="qp-grip" title="Drag to reorder"
  aria-hidden="true" onPointerDown={(e) => startDrag(e, index)}>`.
- `startDrag` (`:908-991`) calls `grip.setPointerCapture(e.pointerId)` and
  attaches `pointermove` / `pointerup` / `pointercancel` **to the grip element**
  (pointer capture retargets them there).
- Rows are re-positioned with **inline `style.transform = translateY(...)`**
  written from a `requestAnimationFrame` loop (compositor-only, no layout).
- The **hover pill** (`.qp-glider`) and the **drag** are separate systems.

**Library dependencies:** none. `react-dnd`, `dnd-kit`, `sortablejs` etc. are
**not** in `package.json`. The only DnD-ish dependency in the app is
`react-resizable-panels` (unrelated) and `liquid-gl` (visual only).

> House rule (`_HouseRules.md:230`): "Do not use HTML5 drag-and-drop. The DnD
> ghost lives in another process and lags the cursor in WebView2. Use pointer
> events."

### 7.2 The controller — VERBATIM (`:908-991`)

```ts
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement>, from: number) => {
      if (e.button !== 0 || q) return
      const list = listRef.current
      if (!list) return
      const grip = e.currentTarget
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.qp-row[data-qidx]'))
      const row = rows[from]
      const fromEntry = filteredQueue[from]
      if (!row || !fromEntry) return

      e.preventDefault()
      draggingRef.current = true
      grip.setPointerCapture(e.pointerId)
      row.classList.add('qp-lift')
      row.style.willChange = 'transform'

      const H = rows[1] ? rows[1].offsetTop - rows[0].offsetTop : 60
      const startY = e.clientY
      const startScroll = list.scrollTop
      /* the list itself does not move during the drag — its rect is read
         ONCE here, never inside the frame loop */
      const listRect = list.getBoundingClientRect()
      let scrollPos = startScroll
      let y = startY
      let to = from
      let raf = 0

      rows.forEach((r) => {
        if (r !== row) r.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)'
      })

      const tick = () => {
        if (y < listRect.top + 36) {
          scrollPos = Math.max(0, scrollPos - 10)
          list.scrollTop = scrollPos
        } else if (y > listRect.bottom - 36) {
          scrollPos += 10
          list.scrollTop = scrollPos
        }
        const dy = y - startY + (scrollPos - startScroll)
        row.style.transform = `translateY(${dy}px)`
        to = Math.max(0, Math.min(rows.length - 1, Math.round(from + dy / H)))
        rows.forEach((rr, i) => {
          if (rr === row) return
          const shift = from < to && i > from && i <= to ? -H : from > to && i < from && i >= to ? H : 0
          rr.style.transform = `translateY(${shift}px)`
        })
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)

      const onMove = (ev: PointerEvent) => { y = ev.clientY }
      const finish = () => {
        cancelAnimationFrame(raf)
        grip.removeEventListener('pointermove', onMove)
        grip.removeEventListener('pointerup', finish)
        grip.removeEventListener('pointercancel', finish)
        rows.forEach((r) => {
          r.style.transform = ''
          r.style.transition = ''
          r.style.willChange = ''
        })
        row.classList.remove('qp-lift')
        draggingRef.current = false
        if (to === from) return
        const toEntry = filteredQueue[to]
        if (!toEntry) return
        if (fromEntry.nextUpIndex >= 0 && toEntry.nextUpIndex >= 0) {
          onReorderQueue(fromEntry.nextUpIndex, toEntry.nextUpIndex)
          return
        }
        if (fromEntry.folderIndex >= 0 && toEntry.folderIndex >= 0 && playingFolderId != null) {
          onReorderFolderTracks(playingFolderId, fromEntry.folderIndex, toEntry.folderIndex)
        }
      }
      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', finish)
      grip.addEventListener('pointercancel', finish)
    },
    [q, filteredQueue, onReorderQueue, onReorderFolderTracks, playingFolderId],
  )
```

### 7.3 Parameter table

| Aspect | Value |
|---|---|
| **Library / mechanism** | Raw pointer events + `setPointerCapture` + rAF. No library. |
| **Trigger** | `pointerdown` on `.qp-grip` only (the row itself is not a drag handle). |
| **Threshold** | **None.** The drag begins on the very first `pointerdown` (`e.preventDefault()`); there is no 5 px / 4 px movement threshold like `PlaylistPanel` has. This is safe because only the grip is the trigger. |
| **Guards** | `e.button !== 0` → ignore. `q` (search text present) → ignore; the grip isn't even rendered while searching (`canDrag = !q && …`). |
| **Row set** | `list.querySelectorAll('.qp-row[data-qidx]')` — only **queue** rows carry `data-qidx`; playlist rows (`qp-t`, `qp-pl`) carry `data-i` / `data-open` and are **not draggable from this panel**. |
| **Row pitch `H`** | `rows[1].offsetTop - rows[0].offsetTop`, fallback `60`. With `height: 56px` + `gap: 4px` this is 60. |
| **Ghost element** | **None.** The dragged row *is* the moving object: it gets `.qp-lift` (`background: rgba(60,60,68,0.78)`, `box-shadow: 0 12px 30px rgba(0,0,0,0.45)`, `z-index: 5`, `cursor: grabbing`, `transition: none`) and `style.transform = translateY(dy)`. No clone, no portal, no `position: fixed` ghost. |
| **Drop indicator** | **None explicitly.** The other rows shift by `∓H` to open a gap — that gap *is* the indicator. |
| **Target index** | `to = clamp(round(from + dy / H), 0, rows.length - 1)`. |
| **Auto-scroll** | Edge band = **36 px** from the list's top/bottom (`listRect` is read **once** at pointerdown, never inside the loop). Speed = **10 px per frame**. `scrollPos` is tracked locally (never re-read from `scrollTop` after writing it). `dy` compensates for the scroll delta. |
| **Other rows' animation** | `transition: transform .2s cubic-bezier(.2,.8,.2,1)` — set inline on every row except the dragged one. |
| **Commit point** | `pointerup` **or** `pointercancel` on the grip → `finish()`. |
| **Cleanup** | All inline `transform` / `transition` / `willChange` are cleared on **every** row; `.qp-lift` removed; `draggingRef.current = false`. |
| **No-op** | `if (to === from) return` — no callback fires. |
| **Suppression of auto-hide** | `draggingRef.current = true` during the drag makes the pointerout handler skip `hideSoon()`. |

### 7.4 The commit rule (which list is reordered)

```ts
        if (fromEntry.nextUpIndex >= 0 && toEntry.nextUpIndex >= 0) {
          onReorderQueue(fromEntry.nextUpIndex, toEntry.nextUpIndex)
          return
        }
        if (fromEntry.folderIndex >= 0 && toEntry.folderIndex >= 0 && playingFolderId != null) {
          onReorderFolderTracks(playingFolderId, fromEntry.folderIndex, toEntry.folderIndex)
        }
```

- **Both rows queued** → `onReorderQueue` with the **play-next indices**, not
  the display indices.
- **Both rows folder-context** and a folder is playing →
  `onReorderFolderTracks(playingFolderId, fromFolderIndex, toFolderIndex)` with
  the indices **inside the folder's own list**.
- **Mixed** (one queued, one context) → **nothing happens**.
- In the library view (`playingFolderId == null`) the context rows still get a
  `folderIndex` (the rotated slot), so the grip renders but the commit is
  dropped by the `playingFolderId != null` guard.

### 7.5 The PlaylistPanel equivalent (the legacy, hidden panel)

`src/components/PlaylistPanel.tsx:617-798` implements a **different, richer**
drag:

| Aspect | QueuePanel | PlaylistPanel (legacy) |
|---|---|---|
| Trigger | the `.qp-grip` handle only | `pointerdown` on the row itself (ignores `button, input, a, textarea`) |
| Threshold | none | **5 px** (`Math.abs(dx) < 5 && Math.abs(dy) < 5`) |
| Pointer type | any | `e.pointerType !== 'mouse'` → ignored |
| Ghost | none — the row moves | a **floating ghost** (`.playlist-row-ghost`, portalled to the body, `position: fixed; opacity: 0; pointer-events: none`, `translate3d` per frame) |
| Drop indicator | the gap between shifted rows | an explicit **2 px emerald marker** (`absolute left-0 right-0 top-0 h-[2px] bg-emerald-300`) plus a `bg-white/[0.04]` tint on the hovered row |
| Hit-testing | index arithmetic only | `document.elementFromPoint` → `[data-row-index]` (row) and `[data-chip-id]` (playlist chip) |
| Auto-scroll | 36 px band, 10 px/frame | 44 px band, speed scaled by depth, `max(±11, over*0.25)` |
| Commit | `onReorderQueue` / `onReorderFolderTracks` | `onAddToPlaylistRef.current(chip, trackId)` or `onReorderRef.current(from, hover)` |
| Click suppression | none needed (the grip is the trigger) | a capture-phase click swallow within 250 ms of a drop |
| Body class | — | `document.body.classList.add('row-dragging')` → `user-select: none; cursor: grabbing` (`src/index.css:836-840`) |

The QueuePanel does **not** have a `data-row-index`, a ghost, or a marker. If
the rebuild is expected to match `PlaylistPanel`'s feel, that is new work; if
it must match the QueuePanel, copy the code above verbatim.

### 7.6 What the harnesses assert about dragging

**Nothing.** No harness in `.verify/` or `app/.verify/` exercises the queue
drag. The only drag-adjacent assertions are:

- `.verify/queuefix.mjs:202` — `.qp-row[data-qidx]` exists and counts the queue
  rows.
- `.verify/queuefix.mjs:245-247` — hovers `.qp-row[data-qidx="1"]` then clicks
  `.qp-row[data-qidx="1"] .qp-acts button[title="Add to queue or playlist"]`
  with `{force: true}` (the acts are `opacity: 0` until hover, so the harness
  forces the click).
- `.verify/polishcheck.mjs:126` — `.qp-row[data-qidx]` exists.

The drag contract is therefore **spec-only** — a rebuild must honour it or the
app's queue reorder silently stops working.

---

## 8. Selectors & accessibility contract

### 8.1 Class names (complete)

`.qp-edge` · `.qp-edge-right` · `.qp-glass` · `.qp-panel` · `.qp-framed` ·
`.qp-side-left` · `.qp-side-right` · `.qp-away` · `.qp-entering` · `.qp-closed`
· `.lg-fallback` · `.qp-in` · `.qp-head` · `.qp-head-actions` · `.qp-ib` ·
`.qp-on` · `.qp-danger` · `.qp-pin` · `.qp-i` · `.qp-pop` · `.qp-range` ·
`.qp-nav` · `.qp-thumb` · `.qp-body` · `.qp-slide-right` · `.qp-slide-left` ·
`.qp-view` · `.qp-bar` · `.qp-sp` · `.qp-pill` · `.qp-pill-sm` · `.qp-icon-pill`
· `.qp-pill-primary` · `.qp-note` · `.qp-list` · `.qp-row` · `.qp-t` · `.qp-pl`
· `.qp-cur` · `.qp-lift` · `.qp-glider` · `.qp-art` · `.qp-art-play` ·
`.qp-meta` · `.qp-acts` · `.qp-folder-acts` · `.qp-fav` · `.qp-chev` ·
`.qp-grip` · `.qp-grip-empty` · `.qp-empty` · `.qp-hint` · `.qp-rn` · `.qp-sbox`
· `.qp-lbl` · `.qp-editor` · `.qp-editor-card` · `.qp-editor-head` ·
`.qp-field` · `.qp-source` · `.qp-poster` · `.qp-poster-img` · `.qp-poster-btns`
· `.qp-filebtn` · `.qp-filebtn-danger` · `.qp-editor-actions` · `.qp-menu` ·
`.qp-menu-lbl` · `.qp-menu-scroll` · `.qp-menu-empty` · `.qp-toast` · `.qp-show`
· `.qp-spin`.

### 8.2 `data-*` attributes

| Attribute | Where | Value |
|---|---|---|
| `data-qidx` | queue row `<li>` | the index in `filteredQueue` |
| `data-queued` | queue row `<li>` | `'true'` / `'false'` |
| `data-i` | track row `<li>` (`qp-t`) | the track id |
| `data-open` | folder row `<li>` (`qp-pl`) | the folder id |
| `data-tab` | `.qp-nav` | `'q'` / `'p'` |
| `data-qp-pop` | `.qp-head-actions` and `.qp-pop` | click-away marker for the glass popover |
| `data-qp-menu` | `.qp-menu` | click-away marker for the track menu |
| `data-lg` | `.qp-panel` | `'gpu'` / `'css'` (removed on destroy) |
| `data-lg-frost` | `.qp-panel` | the blur value as a string |
| `data-lg-refraction` | `.qp-panel` | the refraction value as a string |

### 8.3 ARIA — every label, verbatim

**Structural**

| Element | ARIA |
|---|---|
| `<aside className="qp-panel">` | `aria-label="Queue and playlists"`, `aria-hidden={!open && away}` |
| `<nav className="qp-nav">` | `role="tablist"`, `aria-label="Queue and playlists"`, `data-tab` |
| tab buttons | `role="tab"`, `aria-selected`, `tabIndex` 0/−1 (roving) |
| `.qp-pop` | `role="group"`, `aria-label="Glass settings"`, `data-qp-pop` |
| `.qp-glider` | `aria-hidden="true"` |
| `.qp-grip` | `aria-hidden="true"`, `title="Drag to reorder"` |
| `.qp-toast` | `role="status"`, `aria-live="polite"` |
| `.qp-editor` | `role="dialog"`, `aria-modal="true"`, `aria-label="Edit track"` |
| `.qp-menu` | `role="menu"`, `aria-label={`Actions for ${title}`}`, `data-qp-menu` |
| `.qp-menu` items | `role="menuitem"` |
| `.qp-edge` | `aria-hidden="true"` |
| search input | `aria-label="Search"` |
| range inputs | `aria-label="Panel transparency"`, `"Backdrop blur"`, `"Refraction strength"`, `"Corner radius"` |

**Buttons (exact strings)**

| Where | `aria-label` | `title` |
|---|---|---|
| Header | `New playlist` | `New playlist` |
| Header | `Glass settings` | `Glass settings — transparency, blur, refraction, radius` |
| Header pin | `Keep panel open` | `Keep open` / `Auto-hide when the pointer leaves` |
| Search clear | `Clear search` | — |
| Artwork (track) | `Play ${track.title}` | — |
| Queue row edit | `Edit ${track.title}` | `Edit track` |
| Queue row remove | `Remove ${track.title} from the queue` | `Remove from queue` |
| Track row heart | `Add ${track.title} to favourites` / `Remove ${track.title} from favourites` | `Add to favourites` / `Remove from favourites` |
| Track row edit | `Edit ${track.title}` | `Edit track` |
| Track row plus | `Add ${track.title} to queue or playlist` | `Add to queue or playlist` |
| Track row remove | `Remove ${track.title} from playlist` | `Remove from playlist` |
| Folder row refresh | `Refresh Downloads Online` | `Refresh downloads` |
| Folder row files | `Add files to ${folder.name}` | `Add files to this playlist` |
| Folder row delete | `Delete ${folder.name}` | `Delete playlist` |
| Editor close | `Close editor` | — |
| Rename input | `Rename` | — |

**`aria-pressed` / `aria-expanded`**

- Pin: `aria-pressed={pinned}` (`.qp-pin[aria-pressed='true']` → silver
  background).
- Favourites heart: `aria-pressed={favIds.has(track.id)}`.
- Glass button: `aria-expanded={pop === 'glass'}`.

### 8.4 What the harnesses read (the load-bearing list)

**`.verify/queuefix.mjs`** — the biggest consumer:

| Assertion | Selector |
|---|---|
| Panel exists, width > 200 | `.qp-panel` |
| Header has exactly **2** buttons on the queue tab | `.qp-head` → `button` → `aria-label` |
| No `Close queue panel`, no shuffle, no `Edit mode` / `dock` / `Open current queue` in the header | same |
| Header contains `Glass settings` + `Keep panel open`, **not** `Player settings` | same |
| **No** `.qp-sbox` on *Current queue*; `.qp-sbox` present on *My playlists* | `.qp-sbox` |
| `+` (new playlist) present on the playlists root | `.qp-head button[aria-label="New playlist"]` |
| Queue rows exist and count = number of tracks | `.qp-row[data-qidx]` |
| `.qp-meta` computed `text-align === 'left'` | `.qp-row[data-qidx] .qp-meta` |
| Title font contains `Space Grotesk`; artist font `JetBrains Mono` at exactly `10px` | `.qp-meta b` / `.qp-meta i` |
| **Every** queue row has `.qp-acts button[title="Edit track"]` | `.qp-acts button[title="Edit track"]` |
| Action icons are exactly **13 px** | `.qp-acts .qp-i` |
| `art.right → meta.left` gap is 8–14 px | `.qp-art` vs `.qp-meta` rects |
| The `+` opens `.qp-menu`; it contains `Add to queue`; lists `FAVOURITES` and `Road 66`; **never** `Downloads Online` | `.qp-menu` buttons' `textContent` |
| `.qp-pop[aria-label="Glass settings"]` has exactly **4** `input[type=range]`; labels join to `Transparency,Blur,Refraction,Radius` | `.qp-pop[aria-label="Glass settings"]`, `.qp-range > span` |
| Blur slider → `localStorage['md-qp-glass'].blur === 9`; `panel.dataset.lg ∈ {gpu, css}`; `panel.dataset.lgFrost === '9'`; a `<canvas>` exists when `lg === 'gpu'`; `.qp-in::before` background is `rgba(0, 0, 0, 0)` when `lg === 'gpu'` | — |
| **No** `.qp-pop .qp-seg` (no Blurred/Solid in the glass pop) | `.qp-pop .qp-seg` |
| **No** `.qp-pop-player` and **no** `button[aria-label="Player settings"]` inside the panel | — |
| Every `.qp-bar button` text is `Clear` or `Browse playlists` | `.qp-bar button` |
| **No** `.qp-badge` elements (no ONLINE badges) | `.qp-badge` |
| `.qp-pin` computed background is exactly `rgb(232, 236, 241)` | `.qp-pin` |
| Solid mode: `panel.dataset.lg == null`, no `<canvas>`, background `rgba(16, 16, 21, 0.93)` | — |
| Unpinned + cursor inside → **never** gets `.qp-away`; cursor outside → gets `.qp-away`; returns from the dock edge (`x < 120`, no `qp-away`) | `.qp-panel` className |
| In edit mode: `.qp-panel.qp-framed` exists inside a `z-[60]` LayoutFrame with a dotted box and `[aria-label="Resize bottom-right"]`; **no** `.tracklist-glass` ghost frame | `.qp-panel.qp-framed` |
| `SAVE LAYOUT` persists `md-queue-box` with `w > 300`; `Reset queue panel layout` clears it and removes `qp-framed` | — |

**`.verify/nextprev.mjs`**

- `.qp-row[data-qidx] .qp-meta b` → the queue row titles; asserts the
  **rotation**: current first, the row under the current row is the track
  `Next` plays, already-played tracks sit after the upcoming ones.
- `.qp-row` + `button[title="Add to queue or playlist"]` → then `.qp-menu
  button:text-is("Add to queue")` → the track must play first/second after
  `Next`.
- The queue mask must contain `108px` — **STALE** (the CSS says 96px).
- `.qp-now` (the now-playing strip) — **DOES NOT EXIST** in the current
  source; that whole section of the harness is stale.
- `button[aria-label="Open current queue"]` (on the main screen, not in the
  panel).

**`.verify/polishcheck.mjs`**

- `button[role="tab"]:has-text("My playlists")` / `"Current queue"`.
- `[data-open="100"]` → open the folder.
- `.qp-row.qp-t` must contain `button[aria-label*="favourites"]` and its
  `.qp-meta` mask must contain `calc(100% - 132px)`.
- `.qp-row[data-qidx]` must **not** contain `button[aria-label*="favourites"]`.

**`.verify/motioncheck.mjs`**

- `.qp-panel` class contains `qp-away` / `qp-entering`; computed
  `pointer-events` is `none` while leaving **and** while entering, `auto`
  after.
- The slide must be gradual (≥ 3 intermediate positions) and land in 180–500
  ms.
- `button[aria-label="Keep panel open"]` → the unpin toggle.
- `.qp-panel button[aria-label^="Play "]` → the artwork play buttons (must be
  filtered by `offsetParent !== null`, and skipped when `closest('li')` has
  `.qp-cur`).
- `.qp-panel .qp-pl` → the folder rows.

**`.verify/scrollcheck.mjs`** — hits the **hidden legacy** `PlaylistPanel`'s
`button[aria-label="Refresh downloads"]`, not the QueuePanel's `Refresh
Downloads Online`. Do not rename the QueuePanel's label to match.

**`app/.verify/queuecheck.mjs`** — `page.waitForSelector('.qp-panel')`, then
screenshots and adds `.lg-fallback` to the panel manually.

**`app/.verify/shot.mjs`** — `page.getByRole('tab', { name: 'My playlists' }).click()`
→ the tab's accessible name must be exactly `My playlists`.

**`app/.verify/layers.mjs`** — enumerates positioned elements with `z >= 20`
at (100, 100) to check the stacking order. The panel is `z-index: 80`; the
`.qp-edge` is `79`; `.qp-menu` is `120`; `.qp-editor` is `12` **inside** the
panel.

**`.verify/vizcheck.mjs`, `.verify/appcheck.mjs`, `.verify/drawercheck.mjs`,
`.verify/chromecheck.mjs`, `.verify/lyrcheck.mjs`** — reference
`button[aria-label="Open current queue"]`, `"Customize layout"`, `"Reset queue
panel layout"`, `"Toggle playlists"` (the legacy drawer), `"Player settings"`.
Only the queue-panel-specific ones are listed above.

**`app/tests/`** — `paint.test.mts`, `theme.test.mts`, `songclock.test.mts`,
`visualizer.test.mts`, `lyrics.test.mts`. **None of them touch this panel.**

### 8.5 Selectors that must NOT come back

`.qp-pop-player` (player settings inside the panel) · `.qp-seg` inside the
glass pop · `.qp-badge` (ONLINE badges) · `.qp-now` / `.qp-now-play` (the
now-playing strip) · `.qp-glider` must remain (it is used).

---

## 9. Interactions & edge cases

### 9.1 Open / close / click-away / Escape

- **There is no close button.** The panel is closed by the *auto-hide*
  mechanism only. The header must contain exactly two buttons on the queue
  tab.
- **Click-away** closes the glass popover (outside `pointerdown` not inside
  `[data-qp-pop]`) and the track menu (outside `pointerdown` not inside
  `[data-qp-menu]`). `Escape` closes both (`:1044-1046`, `:1064-1066`).
- **Escape in the search box** clears the query only when the box has text.
- **Escape in the rename field** cancels the rename.
- **Escape in the editor** does **not** close the editor (only the "Close
  editor" / "Cancel" buttons do).
- `onRequestOpen()` is called from `show()` only when `!open` — today `open` is
  always `true`, so it never fires.

### 9.2 Auto-hide / pin

| Mechanism | Detail |
|---|---|
| Default | `pinned = true` → the panel never auto-hides. |
| Unpin | `togglePin()` flips `pinned`/`pinnedRef`; when re-pinning it calls `show()`. |
| Hide trigger | A **document-level** `pointerout` handler (`:609-618`). It fires `hideSoon()` only when the pointer moved from inside `.qp-panel, .qp-menu` to outside, the panel is unpinned, no drag is active, and no hide timer is pending. |
| Grace window | **350 ms**, then the decision is re-checked at fire time: `!pinned && !dragging && !panelRef.current?.matches(':hover')`. `matches(':hover')` is a hit test, not a cached rect. |
| "Inside" is decided by the DOM's own hit-testing | The panel slides with a transform; a rect measured mid-slide once read as off-screen while the cursor sat on the visible panel, and the panel closed under the pointer. **Never use a cached rect for the inside/outside test.** |
| The portalled menu counts as "inside" | The selector is `.qp-panel, .qp-menu`. |
| Reopen | A window `pointermove` (mouse only, not while dragging). The panel reopens only when the pointer **crosses into** the **12 px** dock strip at the panel's side: `atEdge && wasOutside` using `lastMxRef`. Parking the cursor on the strip does **not** reopen it (the classic flicker loop). |
| Slide-in click guard | `show()` sets `entering = true` when the panel was away → `.qp-entering { pointer-events: none !important }` for **360 ms**. |
| Auto-hide is suppressed during a drag | `draggingRef`. |

### 9.3 Keyboard behaviour

| Element | Keys |
|---|---|
| Tab bar | `ArrowLeft` / `ArrowRight` toggle the tab (`preventDefault`). Roving tabindex. |
| Queue row / track row `<li>` | `tabIndex={0}` — focusable, but **no key handler**; `Enter` does nothing. |
| Folder row `<li>` | `Enter` or `Space` → `openFolderView(folder.id)` (`preventDefault`). |
| Rename input | `Enter` → blur (commit). `Escape` → cancel. All keydowns `stopPropagation()`. |
| Search input | `Escape` clears the query (if non-empty). |
| Global | `Escape` closes the glass popover and the track menu. |

> Row-level `Enter`/`Space` play behaviour is **absent** — the artwork button
> is the only keyboard-reachable "play".

### 9.4 Empty states

| Situation | Rendered |
|---|---|
| Queue tab, no rows, no query | `Nothing queued` + a `Browse playlists` pill (`qp-pill qp-pill-sm`) → `switchTab('p')` |
| Queue tab, no rows, query present | `No matches for “{query}”` (curly quotes) |
| Playlists root, no hits | `No matches for “{query}”` — **also rendered with an empty query** when there are no folders at all |
| Folder detail, no tracks | `No tracks yet` + `.qp-hint` `Use FILES to add music to this playlist` |
| Folder detail, query present | `No matches for “{query}”` |
| The menu with no playlists | `.qp-menu-empty` `No playlists yet` |

### 9.5 The download-refresh flow

Two entry points, **both only for `DOWNLOADS_FOLDER_ID`**:

1. **The folder row** (in the playlist list): `aria-label="Refresh Downloads
   Online"`, `title="Refresh downloads"`, glyph `.qp-i.qp-spin` while
   `refreshingDownloads`. `e.stopPropagation()` so the row does not open.
2. **The folder detail bar**: a `qp-pill qp-pill-sm qp-icon-pill` labelled
   `Refreshing` (while busy) or `Refresh`, with the same spinning glyph.
   **No `aria-label` on this one** — harnesses find it by text.

Flow: `onRefreshDownloads()` → Home's `refreshDownloads()` →
`syncDannify()` → `setDannifyNote(n > 0 ? '+N ADDED' : 'UP TO DATE')` → the
panel renders it in `.qp-note` (only when `isDownloads`), and Home clears the
note after **2500 ms**. On error the note is set to `null`.

### 9.6 Selection state across tab switches

- `switchTab` **resets**: `openFolderId → null`, `query → ''`, `renamingId →
  null`, `renamingFolderId → null`, `pop → null`.
- It does **not** reset `skipped` (the local queue-view removals) — but
  `skipped` is keyed by `playingFolderId`, so changing the playing folder
  invalidates it automatically.
- `viewKey` forces the body to remount → the scroll position of the list is
  **reset** on every tab/folder change (it is not preserved).
- The toast survives tab switches (it lives in the panel, not the body).
- The glass popover is closed on a tab switch.
- `queueEntries` / `filteredQueue` are recomputed from the props, so the
  "current" row follows the engine.

### 9.7 Everything a rebuild could plausibly get wrong

1. **The 4-column → 3-column grid override** (`.qp-row.qp-t/.qp-pl`): if you
   drop the empty grip placeholder from the DOM, the grid must change with
   it, or the meta lands in the acts column (right-aligned text). The harness
   asserts `text-align: left` and the 8–14 px art→meta gap.
2. **The mask widths** (96px for queue rows, 132px for `qp-t` rows) must
   match the number of action icons (2 vs 4). Add an icon → widen the mask.
3. **`.qp-acts` is `position: absolute`** — it overlays the meta and relies on
   the mask to fade the text out *before* it reaches the icons.
4. **`.qp-meta` must stay `text-align: left`** — the `justify-self: start` +
   `width: 100%` combination is what keeps it out of the acts column.
5. The glider is an `<li>` inside the `<ul>` — it is absolutely positioned and
   must not affect the row pitch.
6. The row pitch `H` (60 px) is derived from `offsetTop` differences; if the
   row height or the gap changes, `H` follows automatically — but the drag
   maths depends on it.
7. The **queue row order** (current first, then next-up, then the rotated
   context) is asserted by `.verify/nextprev.mjs:417-442`.
8. Search only on the playlists tab — `.verify/queuefix.mjs:187-192` asserts
   `.qp-sbox` is absent on *Current queue*.
9. The header must have exactly 2 buttons on the queue tab and **3 on the
   playlists root** (the `+`).
10. The accent colour is chrome/silver `#e8ecf1`, not amber. `--qp-acc` drives
    the focus outline, the pin's pressed background, the range thumbs' shadow,
    the `.qp-note` colour and the search box's focus ring.
11. **`.qp-panel` transition is `!important`** — liquidGL writes an inline
    `transition: none` during activation; without `!important` the slide and
    the clicks freeze.
12. **`.qp-panel:not(.qp-away):not(.qp-closed) { opacity: 1 !important }`** —
    liquidGL writes an inline `opacity: 0` before its reveal restores it;
    without this the panel blinks.
13. **`.qp-in::before` must be `transparent` while `data-lg='gpu'`** — otherwise
    the panel double-darkens.
14. **`overflow: hidden` + `border-radius: inherit` on both `.qp-panel` and
    `.qp-in`** — the rectangular-edge fix. Removing either paints a square
    dark slab over the rounded corners.
15. **`aria-hidden={!open && away}`** — the panel must not be in the a11y tree
    while it is off-screen.
16. The `+` in the header only exists on the playlists root — not inside a
    folder.
17. The `Refresh` control only exists for Downloads Online, both in the
    folder list and in the detail bar.
18. The favourites heart only exists on playlist track rows — never on queue
    rows, and (inconsistently) not on the search-hit rows in the playlists
    root.
19. The panel never unmounts when hidden — it stays mounted and slides with a
    transform. `.verify/nextprev.mjs` and `.verify/motioncheck.mjs` depend on
    `.qp-panel` always being in the DOM.

---

## 10. Hard requirements / traps

| # | Requirement | Why |
|---|---|---|
| 1 | The `<aside>` must always be mounted with the class string `qp-glass qp-panel qp-side-{side}[ qp-away][ qp-entering][ qp-closed][ qp-framed]`. | Harnesses read `.qp-panel`, `.qp-away`, `.qp-entering`, `.qp-closed`, `.qp-framed` from the className. |
| 2 | `.qp-panel` must be `position: fixed`, `z-index: 80`, `left: max(16px, env(safe-area-inset-left))`, `top: max(56px, env(safe-area-inset-top))`. | The header's left cluster sits at z-65; starting at y16 covered it and swallowed its clicks. |
| 3 | The panel's `width` must be `min(var(--qp-w, 392px), calc(100vw - 32px))` and `height` `min(780px, calc(100dvh - 72px))`. | The layout editor seeds its rectangle from the docked panel. |
| 4 | The panel must expose the `<aside>` element through `outerRef` **on mount** (`setAside` writes `panelRef.current` *and* calls `outerRef`). | `Home.tsx:878-880` stores it to seed the layout editor's box. |
| 5 | `framed` must switch the panel to `position: relative; width: 100%; height: 100%; transition: none !important`. | Inside a `LayoutFrame` a `fixed` panel would escape the frame's rectangle. |
| 6 | The lens must be rebuilt on the `framed` switch (`:461-465`) and destroyed on unmount. | A lens built inside the layout frame dies with the frame on exit. |
| 7 | `data-lg` must be `'gpu'` or `'css'`, and **removed** (`delete el.dataset.lg`) when the lens is destroyed. | `.verify/queuefix.mjs:406-415` asserts `dataset.lg == null` and no `<canvas>` in solid mode. |
| 8 | `data-lg-frost` must be the numeric blur as a string. | `.verify/queuefix.mjs:315` asserts `=== '9'` after the slider moves. |
| 9 | The scrim must yield to the lens tint when `data-lg='gpu'`. | `.verify/queuefix.mjs:320-324` asserts `.qp-in::before` is `rgba(0, 0, 0, 0)`. |
| 10 | The glass preferences must persist to `localStorage['md-qp-glass']` as `{scrim, blur, scale, radius}`. | `.verify/queuefix.mjs:298` parses it. |
| 11 | The blur/refraction sliders must trigger a **debounced (350 ms)** lens rebuild; the transparency slider must use the runtime `setTint`. | liquidGL has no runtime setter for frost/refraction; rebuilding on every slider tick re-rasterises the page. |
| 12 | The `MutationObserver` on `documentElement[data-glass]` must destroy/rebuild the lens. | The Blurred/Solid switch lives on `<html>` and can flip from surfaces that never re-render this panel. |
| 13 | The auto-hide "inside" test must use `matches(':hover')`, never a cached rect. | A rect measured mid-slide read as off-screen and closed the panel under the cursor. |
| 14 | The dock-edge reopen must require a **crossing** (`atEdge && wasOutside`), not mere presence. | Parking the cursor on the strip otherwise reopens the panel in a flicker loop. |
| 15 | `.qp-entering` must suppress pointer events for the whole slide-in. | `.verify/motioncheck.mjs:122` asserts `pointer-events: none` during the slide. |
| 16 | The queue must render the current track first, then the next-up queue, then the context rotated at the playhead. | `.verify/nextprev.mjs:417-442` asserts the exact rotation. |
| 17 | The context rows' `folderIndex` must be the index **inside the folder's list**, not the rotated display slot. | The reorder commit sends `onReorderFolderTracks` with it. |
| 18 | The drag must commit to `onReorderQueue` only when **both** rows are queued, and to `onReorderFolderTracks` only when **both** are folder rows with a playing folder. | Mixed drags must be a no-op, not a corruption. |
| 19 | The drag must clean up every inline `transform`/`transition`/`willChange` on cancel as well as on drop. | A stale `translateY` leaves a row visually offset forever. |
| 20 | The drag must set `draggingRef` so the pointerout handler does not hide the panel mid-drag. | The panel would slide away under the cursor. |
| 21 | The search box must exist **only** on the playlists tab. | `.verify/queuefix.mjs:187-192`. |
| 22 | The `+` (new playlist) must exist **only** on the playlists root (not inside a folder). | `.verify/queuefix.mjs:193-196`. |
| 23 | The add-to-playlist menu must **exclude** Downloads Online. | `.verify/queuefix.mjs:258-263`. |
| 24 | The glass popover must have exactly 4 sliders labelled `Transparency,Blur,Refraction,Radius` and **no** segmented Blurred/Solid control. | `.verify/queuefix.mjs:277-286, 326-329`. |
| 25 | The header must not contain `Player settings`, `Close queue panel`, shuffle, or `Edit mode`/`dock`/`Open current queue`. | `.verify/queuefix.mjs:158-184`. |
| 26 | The pin's pressed background must be `rgb(232, 236, 241)` (chrome silver). | `.verify/queuefix.mjs:353-357`. |
| 27 | No `.qp-badge` element may exist. | `.verify/queuefix.mjs:350-351`. |
| 28 | Every `.qp-bar button` must read `Clear` or `Browse playlists`. | `.verify/queuefix.mjs:341-348`. |
| 29 | Playlist track rows must carry a heart with `aria-label*="favourites"`; queue rows must not. | `.verify/polishcheck.mjs:109-129`. |
| 30 | The `qp-t` meta mask must be `calc(100% - 132px)`. | `.verify/polishcheck.mjs:122`. |
| 31 | Every queue row must carry a `.qp-acts button[title="Edit track"]`. | `.verify/queuefix.mjs:236`. |
| 32 | Action icons must be exactly **13 px** and the title 14 px Space Grotesk / artist 10 px JetBrains Mono. | `.verify/queuefix.mjs:229-237`. |
| 33 | The artwork must be a `<button>` with `aria-label="Play {title}"` and a visible-on-hover play glyph; folder artwork must **not** be a button. | `.verify/motioncheck.mjs:168, 190-191` filter on `button[aria-label^="Play "]` and `offsetParent !== null`. |
| 34 | The tab buttons' accessible names must be exactly `Current queue` and `My playlists`, with `role="tab"`. | `app/.verify/shot.mjs:26` uses `getByRole('tab', { name: 'My playlists' })`; `.verify/queuefix.mjs:189` uses `button[role="tab"]:has-text(...)`. |
| 35 | The panel's `aria-label` must be `Queue and playlists`, and the tablist's too. | — |
| 36 | The legacy `PlaylistPanel` must stay **mounted but hidden** (`<div hidden aria-hidden="true" className="hidden">`). | `.verify/scrollcheck.mjs:76` hits its `Refresh downloads` button; `.verify/queuefix.mjs:497-506` asserts **no** `.tracklist-glass` ghost frame is visible. |
| 37 | The hidden file input must stay outside the panel and `hidden`, with `multiple` and that exact `accept` list. | The upload flow; `.verify/queuefix.mjs:497-500` explicitly notes "the queue panel's own hidden file input must not count" as a ghost. |
| 38 | `z-index` layers must not move: panel `80`, edge `79`, menu `120`, editor `12` (inside), lyrics editor `96` (portal). | `.verify/app/.verify/layers.mjs` enumerates the stack. |
| 39 | `@media (prefers-reduced-motion: reduce)` must kill all transitions/animations inside the panel. | `.verify/nextprev.mjs:376-381` short-circuits on it. |
| 40 | `@media (hover: none)` must force `.qp-acts`, `.qp-folder-acts` and `.qp-grip` visible. | Touch devices have no hover. |
| 41 | Do not write a ref during render; mirror state to refs in an effect. | The react-hooks compiler rejects it (`_HouseRules.md:232-233`). |
| 42 | The `.qp-glider` effect has **no dependency array** — it re-binds on every render. Preserve that (or replicate the behaviour safely). | It re-reads `listRef.current` after every view swap. |

### Known-stale harness expectations (do **not** chase these)

- `.verify/nextprev.mjs:317` expects the queue mask to contain `108px`; the CSS
  says **96px**.
- `.verify/nextprev.mjs:357-396` expects a `.qp-now` now-playing strip with
  `Previous/Pause/Next`; **it does not exist** in the current source.
- `.verify/scrollcheck.mjs` expects `button[aria-label="Refresh downloads"]` —
  that is the **hidden legacy PlaylistPanel**'s button. The QueuePanel's is
  `Refresh Downloads Online`.
