# ARCHIVED — the CD feature

> **Do not import anything from this folder.** Nothing here is reachable from
> the app: no module in `src/` outside this directory imports it, so the whole
> subtree is tree-shaken out of the production bundle and never reaches the
> screen. It is kept **only** so the feature can be brought back without
> rewriting it.

The CD (the 3D MiniDisc that sat on the stage) was removed from the player.
This folder is where its code went.

---

## What is here

| File | What it is |
| --- | --- |
| `DiscCase.tsx` | The 3D disc itself — the case, the chrome arms, the sheens, the scratch interaction, the face swap. |
| `ChromeVisualizer.tsx` | The chrome tribal frame that reacted to the analyser around the disc. |
| `CdSettingsPanel.tsx` | The **CD Settings** card: disc art, the art collection flyout, spin speed, brightness, visibility, and the keyboard-shortcuts switch. |
| `useDiscArt.ts` | The hook behind the disc's artwork — the upload, the collection, and the "which layer is winning" note. |
| `assets/disc.png` | The stock disc face. |
| `assets/chrome.png` | The chrome arms' texture. |
| `assets/disc_backup.png` | An earlier disc face, kept for reference. |

## What is NOT here (and where it went)

| Removed | Where it lives now |
| --- | --- |
| The **CD Settings** button in the transport row | Gone. `Transport.tsx` no longer takes `cdSettingsOpen` / `onToggleCdSettings`. |
| The **CD Settings** panel mount in `Home.tsx` | Gone. |
| `cdVisible` / `setCdVisible` | Gone. The disc had no other visibility switch. |
| `cdBrightness`, `cdSpeed`, `DISC_SPEEDS` | Gone — they only drove the disc. |
| `discBpm` + the BPM analysis effect | Gone. It existed only to spin the disc at the track's tempo. The `web-audio-beat-detector` import went with it. |
| The disc's **layout rectangle** (`md-disc-box`) | Gone — `discLayout` / `discBox` / `discSeed` / `discFramed` and its `LayoutFrame` mount. Nothing drags or resizes the disc any more. |
| The disc's **row in the Customize hub** | Gone — `CustomizePanel` no longer takes `cdVisible` / `discSaved` / `onResetDisc`. |
| The **Ctrl+W** shortcut (upload CD art) | Gone. |
| The **Alt+C** shortcut (toggle the disc) | Gone. |
| The disc's share of the boot gate (`decode(discUrl)`) | Gone — the boot now waits on fonts only. |

### The keyboard-shortcuts switch

`md-shortcuts` is **not** a CD feature — it only happened to live in the CD
Settings card. The switch moved to the **Player Settings** card
(`components/PlayerSettingsPanel.tsx`, the `ShortcutsSwitch` block), where it
reads and writes `localStorage['md-shortcuts']` directly, exactly like the
glass switch beside it. The key handler in `Home.tsx` is unchanged.

### The disc-art storage

`lib/library.ts` still carries the disc-art IndexedDB helpers
(`saveDiscArt`, `loadDiscArt`, `clearDiscArt`, and the `discArtCol:` collection)
because the archived hook above imports them. They are inert in the running
app — nothing outside this folder calls them — but leaving them in place is
what keeps this archive restorable by moving one folder back.

---

## Bringing the feature back

1. Move the contents of this folder back to `src/components/` and
   `src/features/disc/`.
2. Restore the import paths: `DiscCase.tsx` → `../assets/disc.png` and
   `../assets/chrome.png`; `CdSettingsPanel.tsx` → `../features/layout/useChromeDrag`.
3. In `Home.tsx`, re-add: the `DiscCase` / `ChromeVisualizer` imports, the
   `cdVisible` / `cdBrightness` / `cdSpeed` state, the BPM analysis effect, the
   `discLayout` box, the `<CdSettingsPanel>` mount, and the disc's
   `LayoutFrame`.
4. In `Transport.tsx` and `MusicControlPanel.tsx`, re-add the `cdSettingsOpen`
   / `onToggleCdSettings` props and the `SlidersHorizontal` button.
5. In `CustomizePanel.tsx`, re-add the `cdVisible` / `discSaved` /
   `onResetDisc` props and the CD row.
6. The lyrics would need their two CD-relative positions back
   (`LyricsMode` was `'disc-left' | 'disc-right' | 'stage'`; the two boxes were
   `md-lyrics-box-on` / `md-lyrics-box-off`). The one box now is
   `md-lyrics-rect`, and the two old keys are still read as fallbacks — so a
   restored CD would find the old positions again.

**One caveat:** the lyrics' metallic face was tied to the disc
(`metal={cdVisible && !!localLyrics && ...}`). It is now driven by "is this
lyric pinned" alone. If the disc comes back, decide whether the metal face
should follow the disc's visibility again or stay pinned-only.
