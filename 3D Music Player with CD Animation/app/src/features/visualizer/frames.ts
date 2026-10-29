/**
 * Painting the engine's frames.
 *
 * In wallpaper mode the engine renders off-screen and sends the pixels back
 * as base64 RGBA. This turns them into something the screen can show, and
 * does it without touching React: a frame arrives sixty times a second and
 * a re-render per frame would take the whole app down with it.
 *
 * The canvas is the size the engine drew at — the browser scales it to the
 * window, and a soft upscale is exactly what the original renderer did too.
 */

import type { VisualizerFrame } from './bridge'

/** base64 -> bytes, without the spread that would blow the call stack */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Draws frames onto a canvas.
 *
 * Kept as a plain object rather than a component so the drawing loop is
 * started once and stopped once, and so the frames can arrive from anywhere.
 */
export class FramePainter {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private image: ImageData | null = null
  private raf = 0
  private pending: VisualizerFrame | null = null
  private painting = false

  attach(canvas: HTMLCanvasElement | null): void {
    if (this.canvas === canvas) return
    this.canvas = canvas
    /* TRANSPARENT until something is painted: an opaque canvas is black
       before its first frame, and a black canvas over the app is a black
       app */
    this.ctx = canvas?.getContext('2d', { alpha: true }) ?? null
    this.image = null
    if (canvas && !this.painting) {
      this.painting = true
      this.loop()
    }
  }

  /** a frame arrived */
  offer(frame: VisualizerFrame): void {
    this.pending = frame
  }

  /** nothing to show any more */
  clear(): void {
    this.pending = null
    const c = this.ctx
    if (!c || !this.canvas) return
    c.fillStyle = '#000'
    c.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const frame = this.pending
    if (!frame) return
    this.pending = null
    const canvas = this.canvas
    const ctx = this.ctx
    if (!canvas || !ctx) return
    try {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width
        canvas.height = frame.height
        this.image = null
      }
      if (!this.image || this.image.width !== frame.width || this.image.height !== frame.height) {
        this.image = ctx.createImageData(frame.width, frame.height)
      }
      const bytes = fromBase64(frame.data)
      const data = this.image.data
      const n = Math.min(data.length, bytes.length)
      for (let i = 0; i < n; i++) data[i] = bytes[i]
      /* a shorter frame leaves the rest of the buffer stale — the rest of
         the picture would keep the previous frame's pixels */
      for (let i = n; i < data.length; i += 4) {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 255
      }
      ctx.putImageData(this.image, 0, 0)
    } catch {
      /* a malformed frame is not worth crashing the app over */
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.painting = false
    this.canvas = null
    this.ctx = null
    this.image = null
    this.pending = null
  }
}
