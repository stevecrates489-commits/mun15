# ExtensionsPanel — Component Specification

> **Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite 7
>
> This is a **contract**, not a description. An agent rebuilding the UI must
> satisfy every line here. Anything not written here is not part of the
> contract and may be changed freely; anything written here is load-bearing
> and is checked by the harnesses in `.verify/`.
>
> The shipped component is `ExtensionPanel.tsx` — the file name is
> historical. The panel is the **extensions hub**.

---

## Purpose

The entry point for every feature that lives *beside* the core player rather
than inside it — today that is **ONLINE** (the Dannify extension), which runs
in its own window with its own player and library.

---

## Props (Inputs)

```ts
interface Props {
  onOpenOnline: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  pos?: { x: number; y: number } | null
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `onOpenOnline` | `() => void` | Open the ONLINE extension (Dannify). The panel closes itself as part of opening it — the parent owns the transition. |
| `onClose` | `() => void` | Request close. The parent sets `closing`. |
| `closing` | `boolean` | Optional, default `false`. `true` plays the exit animation. |
| `onClosed` | `() => void` | Optional. Called after the exit animation, so the parent can unmount. |
| `pos` | `{ x: number; y: number } \| null` | Optional, default `null`. Where the button that opened the panel sits on screen. |
| `editing` | `boolean` | Optional, default `false`. The layout editor is running — the panel becomes draggable. |
| `offset` | `ChromeOffset` | Optional. The panel's saved drag offset (`{ dx, dy }`). |
| `onOffset` | `(o: ChromeOffset) => void` | Optional. Persist a new drag offset. |

---

## State & Hooks

The panel holds **no local state**. It is a pure view over a list of
extensions.

### Hooks

| Hook | Purpose |
| --- | --- |
| `useChromeDrag({ editing, offset, onOffset })` | Layout-editor drag support. See *House rules*. |
| `useEffect` (closing) | Fires `onClosed` 200 ms after `closing` becomes `true`. |

---

## Event Handlers (Outputs)

| Handler | Signature | Fires when |
| --- | --- | --- |
| `onOpenOnline` | `() => void` | The ONLINE row is clicked. |
| `onClose` | `() => void` | The `✕` is clicked. |
| `onClosed` | `() => void` | The exit animation has finished. |
| `onOffset` | `(o: ChromeOffset) => void` | The panel is dragged in edit mode. |

---

## UI Interactions & Edge Cases

### 1. The panel is a list, not a launcher

> The panel is a list, not a launcher: one row per installed extension, each
> row saying **what the extension is** before it opens.

This is the whole design rule. The corner of the stage must **not** grow a
button per extension — a growing row of corner buttons was the problem this
hub exists to solve. New extensions get a **row** here, never a new corner
knob.

### 2. The installed section

- A heading row: `INSTALLED` on the left, `1 OF 1` on the right.
- The count is **"N OF N"** — the installed count and the total. With one
  extension installed it reads `1 OF 1`.
- The total is the count the extension registry knows about; the installed
  count is how many are actually enabled. A rebuild must keep both.

### 3. The extension row

One row per extension, `w-full`, left-aligned, `items-start`:

| Part | Content |
| --- | --- |
| Icon | A 28 px (`h-7 w-7`) rounded square, `bg-white/10`, holding a `Globe` icon (13 px, `strokeWidth={1.75}`). It brightens on hover. |
| Name | `ONLINE` in mono uppercase, `text-[9px] tracking-[0.16em]`, with an `ArrowUpRight` icon on the right that brightens on hover. |
| Description | `Dannify · its own player and library` — **what the extension is**, in mono, `text-[7px]`, `text-white/35`. |

- The whole row is the button.
- Its title is *"Open the online extension"*.
- The description is **not optional**: the row must say what the extension is
  before it opens, so the user knows what they are about to open.

### 4. Opening an extension closes the hub

`onOpenOnline` is the parent's job, and the parent's implementation closes
the panel as part of opening the extension (the hub would otherwise sit on
top of the extension's own window). The panel must not close itself — the
parent owns the transition, because the extension takes over the screen.

### 5. The footer — where the contract for a new extension lives

A caption at the bottom, in mono, `text-[7px]`, `text-white/25`:

```
EXTENSIONS ADD FEATURES BESIDE THE CORE PLAYER · THE CONTRACT FOR BUILDING
ONE IS IN docs/EXTENSION_SPEC.md
```

The pointer to `docs/EXTENSION_SPEC.md` is part of the contract: a new
extension is built against that document, and the panel says so.

### 6. Position

- `w-64` (256 px) wide.
- With `pos`: `left` is clamped to `[8, window.innerWidth - 256 - 8]`,
  `top` to `[8, window.innerHeight - 320]`.
- Without `pos`: the fallback position `left: 5%`, `top: 13%`.

### 7. Close protocol

Two-stage: the parent sets `closing = true`, the panel adds `is-closing`, and
**200 ms later** it calls `onClosed()`.

### 8. The panel frame

- `settings-panel panel-resizable fx-blur fixed z-[88] w-64`.
- It carries `data-liquid-ignore` — the liquid-glass lens must skip it.
- The header carries `EXTENSIONS` and a `✕` with
  `aria-label="Close extensions panel"`.

---

## Adding a new extension

This panel is the **only** place a new extension gets an entry point. The
contract for building one is `app/docs/EXTENSION_SPEC.md`.

To add one:

1. Build the extension against `docs/EXTENSION_SPEC.md`.
2. Add a **row** to this panel — with its icon, its name and **a sentence
   saying what it is**.
3. Add a prop for its opener (the pattern is `onOpenOnline`) and call it from
   the row's click handler.
4. Do **not** add a corner knob, and do not add a second button to the stage
   chrome.

---

## House rules (shared by every panel in this app)

| Rule | Detail |
| --- | --- |
| **Chrome** | `settings-panel` (entrance/exit animation + hairline scrollbar), `panel-resizable` (native corner resizer, `min-width: 210px`, `min-height: 150px`), `fx-blur` (the glass blur), `thin-scroll` (3 px hairline). |
| **Typography** | Mono, uppercase, wide letter-spacing micro-labels. Section labels are `text-[8px] tracking-[0.2em] text-white/35`. |
| **Touch targets** | `.qp-pill-sm` is the house size: **24 px** tall, `10.5px` font, `r8`. |
| **Glass** | `data-liquid-ignore` marks a surface the liquid-glass lens must skip. |
| **Layout editor** | `useChromeDrag({ editing, offset, onOffset })` returns `{ editClass, style, onPointerDown, onClickCapture }`. Wire `editClass` onto the class list, `style` onto the `style` prop, and the two handlers onto the root as `onPointerDownCapture` / `onClickCapture`. Movement is **unbounded** — nothing is clamped. |
| **Accessibility** | Every icon-only button needs an `aria-label`. Toggles use `aria-pressed`. Disclosure rows use `aria-expanded`. |
| **Motion** | The house curve is `cubic-bezier(0.22, 1, 0.36, 1)`. Respect `prefers-reduced-motion`. |
