/* Colour math for the wallpaper colour picker.

   One representation travels everywhere: HSV + alpha. It is what the picker
   edits directly (a hue strip and a saturation/value square ARE the HSV
   axes), so nothing has to round-trip through RGB while the user drags, and
   it converts to CSS at the last moment. Alpha is kept 0..1 and folded into
   an 8-digit hex for the input field, matching the swatch readout in the
   design. */

export interface Hsv {
  /** 0..360 */
  h: number
  /** 0..1 */
  s: number
  /** 0..1 */
  v: number
  /** 0..1 */
  a: number
}

/* the picker's opening position — the violet from the reference design */
export const DEFAULT_WALL_COLOR: Hsv = { h: 266, s: 0.77, v: 0.96, a: 1 }

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/** `rgba(...)` for the live wallpaper layer and the picker's own chrome. */
export function hsvToCss(c: Hsv): string {
  const [r, g, b] = hsvToRgb(c)
  return `rgba(${r},${g},${b},${Math.round(clamp01(c.a) * 1000) / 1000})`
}

/** `#RRGGBBAA` — what the picker's field shows. */
export function hsvToHex8(c: Hsv): string {
  const [r, g, b] = hsvToRgb(c)
  const to2 = (n: number) => n.toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}${to2(Math.round(clamp01(c.a) * 255))}`.toUpperCase()
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max, a: 1 }
}

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Returns null when invalid. */
export function hexToHsv(input: string): Hsv | null {
  const hex = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  let r: number
  let g: number
  let b: number
  let a = 1
  if (hex.length === 3 || hex.length === 4) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
    if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255
  } else {
    return null
  }
  return { ...rgbToHsv(r, g, b), a: Math.round(a * 1000) / 1000 }
}

/* ── the wallpaper paint ───────────────────────────────────────────────────
   The wallpaper layer paints ONE of two things: a flat colour, or a
   two-stop gradient. Both live under a single `Paint` value so the picker,
   the header swatch and the layer can never disagree about what is on
   screen — and switching between them is a CONVERSION, never a reset. */

export interface WallGradient {
  from: Hsv
  to: Hsv
  /** CSS degrees — 0 points up, 90 points right */
  angle: number
}

export type Paint =
  | { kind: 'solid'; color: Hsv }
  | { kind: 'gradient'; gradient: WallGradient }

/* the gradient the picker opens on: the same violet as the flat colour,
   falling away to a cold blue at 135° */
export const DEFAULT_WALL_GRADIENT: WallGradient = {
  from: DEFAULT_WALL_COLOR,
  to: { h: 206, s: 0.82, v: 0.45, a: 1 },
  angle: 135,
}

/** `linear-gradient(...)` — the wallpaper layer and the picker's preview. */
export function gradientCss(g: WallGradient): string {
  const angle = ((Math.round(g.angle) % 360) + 360) % 360
  return `linear-gradient(${angle}deg, ${hsvToCss(g.from)}, ${hsvToCss(g.to)})`
}

/** what the layer paints, as CSS. */
export function paintCss(p: Paint): string {
  return p.kind === 'solid' ? hsvToCss(p.color) : gradientCss(p.gradient)
}

/** `#RRGGBB` — the 6-digit form used in the swatch tooltip and stop chips. */
export function hsvToHex(c: Hsv): string {
  const [r, g, b] = hsvToRgb(c)
  const to2 = (n: number) => n.toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase()
}

/** one-line description of a paint — the swatch's tooltip. */
export function paintLabel(p: Paint): string {
  return p.kind === 'solid'
    ? `SOLID ${hsvToHex(p.color)}`
    : `GRADIENT ${hsvToHex(p.gradient.from)} → ${hsvToHex(p.gradient.to)}`
}

/** type guard for values read back out of localStorage. */
export function isHsv(v: unknown): v is Hsv {
  if (!v || typeof v !== 'object') return false
  const c = v as Partial<Hsv>
  return (
    typeof c.h === 'number' &&
    typeof c.s === 'number' &&
    typeof c.v === 'number' &&
    typeof c.a === 'number'
  )
}

/** read a persisted paint back, tolerating a corrupt or half-written entry. */
export function parsePaint(raw: string | null): Paint | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as {
      kind?: string
      color?: unknown
      gradient?: { from?: unknown; to?: unknown; angle?: unknown }
    }
    if (p?.kind === 'solid' && isHsv(p.color)) return { kind: 'solid', color: p.color }
    if (p?.kind === 'gradient' && p.gradient && isHsv(p.gradient.from) && isHsv(p.gradient.to)) {
      const angle = Number(p.gradient.angle)
      return {
        kind: 'gradient',
        gradient: {
          from: p.gradient.from,
          to: p.gradient.to,
          angle: Number.isFinite(angle) ? angle : DEFAULT_WALL_GRADIENT.angle,
        },
      }
    }
  } catch {
    /* corrupt entry — the caller falls back to the default */
  }
  return null
}
