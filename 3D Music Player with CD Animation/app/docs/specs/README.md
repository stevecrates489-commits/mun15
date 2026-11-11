# Panel Specifications — index

**Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`)

These are **contracts**, not descriptions. An agent rebuilding the UI must
satisfy every line in the relevant spec. Anything not written there is free to
change; anything written there is load-bearing and is checked by the
verification harnesses in `3D Music Player with CD Animation/.verify/`.

---

## Read in this order

| # | File | What it covers |
| --- | --- | --- |
| 0 | [`_HouseRules.md`](_HouseRules.md) | **Read first.** The shared vocabulary: the class recipe, the close protocol, the layout-editor contract, typography, controls, scrollbars, and the list of rules that are easy to break. |
| 1 | [`LyricsPanel.SPEC.md`](LyricsPanel.SPEC.md) | **Part A** — the lyrics themselves (the `<am-lyrics>` host): one panel, one position (the stage), one movable rectangle. **Part B** — the lyrics settings card: the draggable provider list, PIN/EDIT, size, brightness, sync offset, download. |
| 2 | [`WallpaperPanel.SPEC.md`](WallpaperPanel.SPEC.md) | Conversion quality and FPS, speed, blur, dim, pause-when-hidden, and the **"YOUR WALLPAPERS" hover flyout**. |
| 3 | [`RadioPanel.SPEC.md`](RadioPanel.SPEC.md) | The **KNOWN STATIONS / SEARCH** tabs, the language-and-country pickers, the federation search, the now-playing strip, the ICY song clock, and the advanced metadata options. |
| 4 | [`PlayerSettings.SPEC.md`](PlayerSettings.SPEC.md) | Crossfade and its length, volume normalisation, the glass/solid switch, the keyboard-shortcuts switch, accent-from-art. |
| 5 | [`CustomizePanel.SPEC.md`](CustomizePanel.SPEC.md) | The layout hub: start the edit session, the lyrics custom-position toggle, and the per-region resets. |
| 6 | [`ExtensionsPanel.SPEC.md`](ExtensionsPanel.SPEC.md) | The extension hub — one row per extension, and how to add a new one. |

---

## The components these describe

| Spec | Shipped file | Location |
| --- | --- | --- |
| LyricsPanel (A) | `LyricsPanel.tsx` | `app/src/components/` |
| LyricsSettingsPanel (B) | `LyricsSettingsPanel.tsx` + `features/lyrics/ProviderList.tsx` | `app/src/components/`, `app/src/features/lyrics/` |
| WallpaperPanel | `WallpaperSettingsPanel.tsx` | `app/src/components/` |
| RadioPanel | `RadioPanel.tsx` | `app/src/components/` |
| PlayerSettings | `PlayerSettingsPanel.tsx` | `app/src/components/` |
| CustomizePanel | `CustomizePanel.tsx` | `app/src/components/` |
| ExtensionsPanel | `ExtensionPanel.tsx` | `app/src/components/` |

Three of these file names are historical — the *Wallpaper*, *PlayerSettings*
and *Extensions* panels are all `…SettingsPanel` / `ExtensionPanel` on disk.
The spec names are the ones used throughout the docs.

---

## Two things to know before you start

**1. The panel is a controlled component.** It owns no state beyond what the
brief explicitly gives it (the lyrics' `scrolled` flag, the wallpaper's
flyout and arm flags, the radio's tab and query). Everything else arrives as
a prop and leaves through a callback. A rebuilt panel that keeps its own copy
of a prop will desync from the app.

**2. The house rules are not negotiable.** The class recipe, the two-stage
close protocol, the hairline scrollbar, the mono uppercase micro-labels and
the accessibility attributes are what make a panel look and behave like the
rest of this app. `_HouseRules.md` §11 lists the specific rules that have
already cost a bug here.
