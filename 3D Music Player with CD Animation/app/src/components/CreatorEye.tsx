import { useEffect, useRef } from 'react'
import { ensureEyeEngine } from '../lib/eyeEngine'

/**
 * Attaches the cached eye engine's canvas (built once at boot, kept warm).
 * Mounting sets it rendering; unmounting pauses it until next time.
 */
export default function CreatorEye({ size = 100 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let attached: HTMLCanvasElement | null = null
    let deactivate: (() => void) | null = null
    ensureEyeEngine().then((e) => {
      if (!alive) {
        e.setActive(false)
        return
      }
      attached = e.canvas
      e.canvas.style.width = `${size}px`
      e.canvas.style.height = `${size}px`
      e.canvas.style.display = 'block' /* inline canvas leaves a baseline gap — the circle wrapper would sit a few px low */
      hostRef.current?.appendChild(e.canvas)
      deactivate = () => e.setActive(false)
      e.setActive(true)
    })
    return () => {
      alive = false
      attached?.remove()
      deactivate?.()
    }
  }, [size])

  return (
    <div
      ref={hostRef}
      style={{
        width: size,
        height: size,
      }}
    />
  )
}
