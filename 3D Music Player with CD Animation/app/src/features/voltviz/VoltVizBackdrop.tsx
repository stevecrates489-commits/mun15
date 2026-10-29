/**
 * A VoltViz style, painted across the player's background.
 *
 * The styles are VoltViz's own modules (MIT, see LICENSE beside this folder),
 * mounted the way VoltViz mounts them: a plain container, a factory, and one
 * call per frame with the audio frame and the settings. Nothing about them
 * knows about the player, and nothing here knows how any one of them draws.
 *
 * They read the deck's own analyser (`audio.ts`), so what is on screen is the
 * track that is playing — not a simulation.
 *
 * Switching styles is a crossfade: the layer that is going out keeps its last
 * picture under the incoming one until the incoming one has drawn a real
 * frame, so a switch never drops to the theme underneath while the next
 * module loads.
 */

import { memo, useEffect, useRef } from 'react'
import { loadVisualizer } from './modules'
import { visualizers } from './registry'
import { dpr } from '../../lib/adaptiveQuality'
import { createAudioFrameSource } from './audio'
import type { VisualizerInstance } from './runtime-types'
import type { VisualizerSettings } from './settings'

interface Props {
  /** registry id, or null for none */
  style: string | null
  /** the selected style's tuning — applied live, without remounting it */
  settings: VisualizerSettings
  getAnalyser: () => AnalyserNode | null
  /** the mounted style's own api, when it has one (its mode, image, …) */
  onApi?: (api: Record<string, (...args: never[]) => unknown> | null) => void
  /** the wallpaper's BLUR switch, shared with the backdrop */
  blur?: boolean
  /** the wallpaper's DIM slider (0–80), shared with the backdrop */
  dim?: number
}

/* how long one visual takes to fade into the next — and how long the layer
   being replaced is left in the DOM after that, so nothing disappears
   mid-fade */
const FADE_MS = 400
const REMOVE_AFTER_MS = FADE_MS + 60

/* Flame paints its own glow field where it is not burning, and it is wanted
   on black: the layer is black before the first pixel lands and under any
   error message, so the theme never bleeds through it. Moss Ball ("Muse
   Balls") paints soft lit spheres that likewise need a black stage, and the
   two full-screen ones (Bar Graph, Butterchurn) paint every pixel themselves. */
const blackFor = (style: string) =>
  style === 'flame' || style === 'mossball' || style === 'bargraph' || style === 'butterchurn'

/** Retire layers whose successor is in place (or that nothing is coming for). */
function settle(layers: HTMLElement[], fadeOut: boolean) {
  for (const el of layers) {
    if (fadeOut) {
      el.style.transition = `opacity ${FADE_MS}ms ease`
      el.style.opacity = '0'
    }
    window.setTimeout(() => el.remove(), REMOVE_AFTER_MS)
  }
}

export const VOLTVIZ_STYLES = visualizers

function VoltVizBackdrop({ style, settings, getAnalyser, onApi, blur = false, dim = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  /* layers whose visual has been replaced but whose picture is still up —
     each one is retired by whoever arrives next, or faded out when the
     visuals are turned off */
  const outgoingRef = useRef<HTMLElement[]>([])

  /* ONE object for the whole run, mutated in place: the styles hold on to
     the reference they were mounted with — some read it every frame, some
     captured it once at mount — so the FIELDS are what change when a slider
     moves, never the object they are holding. */
  const liveRef = useRef<VisualizerSettings>({ ...settings })
  const onApiRef = useRef(onApi)
  useEffect(() => {
    onApiRef.current = onApi
  }, [onApi])
  /* Declared before the mount effect below, so the first mount with a style
     already chosen runs this first and mounts with today's values. */
  useEffect(() => {
    Object.assign(liveRef.current, settings)
  }, [settings])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    /* nothing selected: the last picture fades out and the theme returns */
    if (!style) {
      settle(outgoingRef.current, true)
      outgoingRef.current = []
      return
    }

    const entry = visualizers.find((v) => v.id === style)
    if (!entry) {
      /* an id nothing knows: nothing is coming, so let the old layer go */
      settle(outgoingRef.current, true)
      outgoingRef.current = []
      return
    }

    let disposed = false
    let raf = 0
    let instance: VisualizerInstance | null = null
    let observer: ResizeObserver | null = null
    let arrived = false

    const container = document.createElement('div')
    container.style.cssText =
      `position:absolute;inset:0;overflow:hidden;opacity:0;transition:opacity ${FADE_MS}ms ease` +
      (blackFor(style) ? ';background:#000' : '')
    host.appendChild(container)

    /* The new picture is real: fade it up over the old one and retire the
       old one once the fade is done. This is the whole of the smooth switch. */
    const arrive = () => {
      if (arrived || disposed) return
      arrived = true
      container.style.opacity = '1'
      const gone = outgoingRef.current
      outgoingRef.current = []
      settle(gone, false)
    }

    const loop = () => {
      if (disposed || !instance) return
      const now = performance.now()
      const { width, height } = size()
      const frame = source.read(now)
      try {
        instance.frame({
          audio: frame,
          settings: liveRef.current,
          metadata: null,
          time: frame.time,
          dt: frame.dt,
          width,
          height,
          dpr: dprOf(),
        })
      } catch (err) {
        /* One broken style must not take the window with it — and it must not
           leave a blank one either: the layer says what happened and stops. */
        console.error(`[voltviz] ${style} stopped`, err)
        cancelAnimationFrame(raf)
        container.textContent = "THIS VISUAL NEEDS A GPU FEATURE THIS MACHINE DOES NOT HAVE"
        container.style.cssText =
          'position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.2em;color:rgba(255,255,255,.3)'
        if (blackFor(style)) container.style.background = '#000'
        arrive()
        return
      }
      arrive() /* first drawn frame — the fade-in may start now */
      raf = requestAnimationFrame(loop)
    }

    const source = createAudioFrameSource(getAnalyser)
    /* the display's ratio, and whatever the frame-rate governor currently
       allows — see lib/adaptiveQuality */
    const dprOf = () => dpr()
    const size = () => ({ width: host.clientWidth || window.innerWidth, height: host.clientHeight || window.innerHeight })

    void loadVisualizer(entry)
      .then((mod) =>
        mod.default({
          container,
          ...size(),
          dpr: dprOf(),
          settings: liveRef.current,
          metadata: null,
          /* the live node, for the visual that mixes its own audio — and the
             getter, because the deck may build its graph after this mount */
          analyser: getAnalyser(),
          getAnalyser,
        }),
      )
      .then((mounted) => {
        if (disposed) {
          mounted.dispose()
          return
        }
        instance = mounted
        onApiRef.current?.(mounted.api ?? null)
        observer = new ResizeObserver(() => {
          const { width, height } = size()
          instance?.resize?.(width, height, dprOf())
        })
        observer.observe(host)
        raf = requestAnimationFrame(loop)
      })
      .catch((err: unknown) => {
        console.error(`[voltviz] ${style} would not start`, err)
        container.textContent = 'THIS VISUAL WOULD NOT START'
        container.style.cssText =
          'position:absolute;inset:0;display:grid;place-items:center;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.2em;color:rgba(255,255,255,.3)'
        if (blackFor(style)) container.style.background = '#000'
        arrive()
      })

    return () => {
      disposed = true
      onApiRef.current?.(null)
      cancelAnimationFrame(raf)
      observer?.disconnect()
      try {
        instance?.dispose()
      } catch {
        /* already gone */
      }
      source.reset()
      /* the picture stays up under whatever comes next — the next arrival
         (or the fade-out when the visuals are turned off) retires it */
      outgoingRef.current.push(container)
    }
  }, [style, getAnalyser])

  /* The layer sits above the theme paints and below a custom wallpaper, the
     same rung the spectrum backdrop used to hold: it is the backdrop on the
     black, aurora and colour themes, and steps aside for a picture.

     It stays mounted with nothing in it when the visuals are off — the last
     picture fades out through this element rather than vanishing with it. */
  /* The layer sits above the theme paints AND above a custom wallpaper —
     a live visual is a replacement backdrop, not a guest behind the picture
     (its own BLUR/DIM switches from the wallpaper panel apply to it too).

     It stays mounted with nothing in it when the visuals are off — the last
     picture fades out through this element rather than vanishing with it. */
  const filter = [blur ? 'blur(6px)' : '', dim > 0 ? `brightness(${1 - dim / 100})` : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="bg-layer pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      style={
        filter || blur
          ? {
              ...(filter ? { filter } : {}),
              ...(blur ? { transform: 'scale(1.06)' } : {}),
            }
          : undefined
      }
    />
  )
}

export default memo(VoltVizBackdrop)
