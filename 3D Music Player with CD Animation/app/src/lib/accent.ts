/**
 * Accent-from-art: the dominant colours of the playing track's cover, pulled
 * by hand. No dependency — the art is downsampled to a 24×24 grid, its pixels
 * are bucketed by hue with saturation as the weight, and the two strongest
 * DISTINCT buckets come back as a pair (adjacent buckets are refused, so
 * two-tone art gives a real contrast rather than one colour twice).
 *
 * A tainted canvas (a cover served without CORS) throws on the pixel read —
 * the caller keeps whatever accent it already had.
 */

export interface AccentPair {
  a: [number, number, number]
  b: [number, number, number]
}

/** the pair the UI wears when nothing is extracted (the classic deck accent) */
export const ACCENT_DEFAULTS: AccentPair = { a: [125, 216, 255], b: [201, 156, 255] }

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hh = (h % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hh < 1) [r, g, b] = [c, x, 0]
  else if (hh < 2) [r, g, b] = [x, c, 0]
  else if (hh < 3) [r, g, b] = [0, c, x]
  else if (hh < 4) [r, g, b] = [0, x, c]
  else if (hh < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export async function extractAccents(src: string): Promise<AccentPair | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('decode failed'))
      img.src = src
    })
    if (!img.width || !img.height) return null

    const N = 24
    const canvas = document.createElement('canvas')
    canvas.width = N
    canvas.height = N
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, N, N)
    const data = ctx.getImageData(0, 0, N, N).data /* throws on a tainted canvas */

    const weight = new Float32Array(12)
    const rs = new Float32Array(12)
    const gs = new Float32Array(12)
    const bs = new Float32Array(12)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (data[i + 3] < 128) continue
      const { h, s, v } = rgbToHsv(r, g, b)
      /* greys (which includes blown white — its saturation is ~0) and
         near-black carry no accent, so they are skipped. Value is NOT a
         filter on its own: a bright, fully saturated cover — the usual
         pop/poster art — is exactly the accent we want, and the old
         `v > 0.98` clause threw every one of those pixels away, which left
         the whole cover weighing nothing and the UI stuck on the deck's
         default pair for that track. */
      if (s < 0.18 || v < 0.12) continue
      const bucket = Math.min(11, Math.floor(h / 30))
      const w = s * (0.35 + 0.65 * v)
      weight[bucket] += w
      rs[bucket] += r * w
      gs[bucket] += g * w
      bs[bucket] += b * w
    }

    let first = -1
    for (let i = 0; i < 12; i++) if (first < 0 || weight[i] > weight[first]) first = i
    if (first < 0 || weight[first] <= 0) return null

    /* the second colour: the strongest bucket at least two steps away, so
       the pair contrasts instead of echoing */
    let second = -1
    for (let i = 0; i < 12; i++) {
      if (i === first) continue
      const apart = Math.min(Math.abs(i - first), 12 - Math.abs(i - first))
      if (apart < 2) continue
      if (weight[i] < weight[first] * 0.2) continue
      if (second < 0 || weight[i] > weight[second]) second = i
    }

    const fa = hsvToRgb((first * 30 + 15) % 360, 0.72, 0.9)
    const fb =
      second >= 0
        ? hsvToRgb((second * 30 + 15) % 360, 0.66, 0.82)
        : hsvToRgb((first * 30 + 15 + 55) % 360, 0.6, 0.78)
    return { a: fa, b: fb }
  } catch {
    return null
  }
}
