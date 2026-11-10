import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import './CylinderCarousel.css'

/** The slice of a track the carousel needs — the app's Track already fits. */
export interface CylinderTrack {
  id: number
  title: string
  artist: string
  cover?: string
}

export interface CylinderSettings {
  react: number
  decay: number
  spread: number
  falloff: number
  drop: number
  yaw: number
  perspective: number
  dim: number
  fill: number
  blur: number
}

const DEFAULTS: CylinderSettings = {
  react: 1.2,
  decay: 0.88,
  spread: 1.5,
  falloff: 0.75,
  drop: 0.07,
  yaw: 24,
  perspective: 1000,
  dim: 0.08,
  fill: 1,
  blur: 18,
}

const SETTINGS_KEY = 'md-cylinder-settings'

function readSettings(): CylinderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<CylinderSettings>
    const out = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS) as (keyof CylinderSettings)[]) {
      const v = p[key]
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    }
    return out
  } catch {
    return { ...DEFAULTS }
  }
}

const SLIDERS: readonly {
  key: keyof CylinderSettings
  label: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'react', label: 'Pulse strength', min: 0, max: 4, step: 0.05 },
  { key: 'decay', label: 'Pulse decay', min: 0.7, max: 0.97, step: 0.01 },
  { key: 'spread', label: 'Spread', min: 0.8, max: 2.4, step: 0.01 },
  { key: 'falloff', label: 'Shrink with distance', min: 0.3, max: 1.6, step: 0.01 },
  { key: 'drop', label: 'Drop', min: 0, max: 0.2, step: 0.005 },
  { key: 'yaw', label: 'Yaw (deg)', min: 0, max: 50, step: 1 },
  { key: 'perspective', label: 'Perspective', min: 400, max: 2500, step: 10 },
  { key: 'dim', label: 'Side dimming', min: 0, max: 0.7, step: 0.01 },
  { key: 'fill', label: 'Card glass fill', min: 0, max: 2, step: 0.05 },
  { key: 'blur', label: 'Card blur (px)', min: 0, max: 40, step: 1 },
]

interface Props {
  /** the active list — the selected playlist, or the whole library */
  tracks: CylinderTrack[]
  /** the engine's current track, if it is in this list */
  currentId: number | null
  playing: boolean
  /** engine's playhead subscription, for the card progress line */
  subscribeTime?: (cb: (t: number) => void) => () => void
  duration?: number
  /** the deck's own analyser — no second AudioContext is ever created */
  getAnalyser: () => AnalyserNode | null
  /** global edit mode: enables the gear and disables carousel gestures */
  editing: boolean
  /** controlled focus, so the app knows which card is highlighted */
  focusedIndex: number
  onFocusChange: (index: number) => void
  onPlay: (trackId: number) => void
  onToggle: () => void
}

const wrap = (n: number, count: number) => (count ? ((n % count) + count) % count : 0)

export default function CylinderCarousel({
  tracks,
  currentId,
  playing,
  subscribeTime,
  duration = 0,
  getAnalyser,
  editing,
  focusedIndex,
  onFocusChange,
  onPlay,
  onToggle,
}: Props) {
  const [settings, setSettings] = useState<CylinderSettings>(readSettings)
  const [gearOpen, setGearOpen] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<(HTMLButtonElement | null)[]>([])
  const kickRef = useRef<() => void>(() => {})
  const rafRef = useRef(0)
  const dragRef = useRef<{ x: number; start: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const wheelTimerRef = useRef(0)
  const posRef = useRef(focusedIndex)
  const targetRef = useRef(focusedIndex)
  const focusRef = useRef(focusedIndex)
  const tracksRef = useRef(tracks)
  const settingsRef = useRef(settings)
  const editingRef = useRef(editing)
  const currentIdRef = useRef(currentId)
  const durationRef = useRef(duration)
  const layoutRef = useRef({ cardW: 190, cardH: 100 })
  const onFocusRef = useRef(onFocusChange)
  const reduceRef = useRef(false)

  useEffect(() => {
    tracksRef.current = tracks
    settingsRef.current = settings
    editingRef.current = editing
    currentIdRef.current = currentId
    durationRef.current = duration
    onFocusRef.current = onFocusChange
  }, [tracks, settings, editing, currentId, duration, onFocusChange])

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* private mode — this session still has the values */
    }
  }, [settings])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduceRef.current = media.matches
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  /* ---- one loop for the whole ring. It reads live values from refs, so
     settings, tracks and drags never restart it; it stops itself once the
     ring has settled (no permanent 60fps work for an idle widget). ---- */
  useEffect(() => {
    let last = 0
    const step = (ts: number) => {
      const dt = Math.min(48, ts - (last || ts - 16))
      last = ts
      const reduce = reduceRef.current
      const target = targetRef.current
      const down = dragRef.current
      const ease = down?.moved ? 45 : 115
      posRef.current += (target - posRef.current) * (reduce ? 1 : 1 - Math.exp(-dt / ease))
      const settled = Math.abs(target - posRef.current) < 0.0004
      if (settled) {
        posRef.current = target
        last = 0
      }

      const list = tracksRef.current
      const n = list.length
      const { cardW, cardH } = layoutRef.current
      const s = settingsRef.current
      for (let i = 0; i < n; i++) {
        const card = cardsRef.current[i]
        if (!card) continue
        let d = i - posRef.current
        d -= n * Math.round(d / n)
        const a = Math.abs(d)
        if (a > 3.2) {
          if (card.style.visibility !== 'hidden') card.style.visibility = 'hidden'
          continue
        }
        card.style.visibility = 'visible'
        const sg = Math.sign(d)
        const scale = 1 / (1 + s.falloff * a)
        const x = sg * cardW * s.spread * (1 - Math.exp(-0.8 * a))
        const y = cardH * s.drop * Math.pow(a, 0.9)
        const yaw = -sg * s.yaw * (1 - Math.exp(-0.7 * a))
        card.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) perspective(${s.perspective}px) rotateY(${yaw.toFixed(2)}deg) scale(${scale.toFixed(4)})`
        card.style.zIndex = String(100 - Math.round(a * 10))
        card.style.opacity = String(Math.min(1, 3.2 - a))
        card.style.setProperty('--cyl-dim', Math.min(0.7, a * s.dim).toFixed(3))
      }

      const focus = wrap(Math.round(posRef.current), n)
      if (focus !== focusRef.current) {
        focusRef.current = focus
        onFocusRef.current(focus)
      }

      if (settled) {
        rafRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }

    const kick = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(step)
    }
    kickRef.current = kick
    kick()
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  const goTo = useCallback((index: number) => {
    const n = tracksRef.current.length
    if (!n) return
    const base = Math.round(targetRef.current)
    let d = index - wrap(base, n)
    d -= n * Math.round(d / n)
    targetRef.current = base + d
    kickRef.current()
  }, [])

  /* keep the ring in range when the active list changes. The controlled
     focus prop is deliberately NOT a dependency: listening to it here would
     snap the fractional drag target back to an integer on every card change. */
  useEffect(() => {
    if (!tracks.length) {
      posRef.current = 0
      targetRef.current = 0
      focusRef.current = 0
      return
    }
    const at = Math.min(Math.round(targetRef.current), tracks.length - 1)
    targetRef.current = at
    focusRef.current = at
    onFocusRef.current(at)
  }, [tracks.length])

  /* the engine's track is the true centre: external play actions and
     auto-advance both move the ring to the song that is actually playing */
  useEffect(() => {
    if (currentId == null) return
    const at = tracks.findIndex((t) => t.id === currentId)
    if (at >= 0) goTo(at)
  }, [currentId, tracks, goTo])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const cardH = Math.max(58, Math.min(r.height * 0.62, r.width * 0.34))
      layoutRef.current = { cardH, cardW: Math.min(cardH * 1.9, r.width * 0.68) }
      el.style.setProperty('--cyl-card-w', `${layoutRef.current.cardW}px`)
      el.style.setProperty('--cyl-card-h', `${cardH}px`)
      kickRef.current()
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  /* playhead — the card's line follows the same clock as the main player */
  useEffect(() => {
    if (!subscribeTime) return
    return subscribeTime((t) => {
      const at = tracksRef.current.findIndex((x) => x.id === currentIdRef.current)
      const card = at >= 0 ? cardsRef.current[at] : null
      const dur = durationRef.current
      if (card) card.style.setProperty('--cyl-prog', dur > 0 ? String(Math.min(1, t / dur)) : '0')
    })
  }, [subscribeTime])

  /* a new song starts its card's line at the beginning */
  useEffect(() => {
    const at = tracks.findIndex((t) => t.id === currentId)
    const card = at >= 0 ? cardsRef.current[at] : null
    card?.style.setProperty('--cyl-prog', '0')
  }, [currentId, tracks])

  /* pulse — spectral flux from the deck's existing analyser. If there is no
     analyser (radio without a tap, or an engine that has not started), the
     cards simply keep their static glow; nothing else is constructed. */
  useEffect(() => {
    const index = tracks.findIndex((t) => t.id === currentId)
    const card = index >= 0 ? cardsRef.current[index] : null
    if (!card) return
    if (!playing) {
      card.style.setProperty('--p', '0')
      return
    }
    const analyser = getAnalyser()
    if (!analyser) {
      card.style.setProperty('--p', '0')
      return
    }
    const freq = new Uint8Array(analyser.frequencyBinCount)
    const prev = new Uint8Array(analyser.frequencyBinCount)
    let lvl = 0
    let peak = 0.05
    let raf = 0
    const loop = () => {
      analyser.getByteFrequencyData(freq)
      let flux = 0
      for (let i = 0; i < 16; i++) {
        flux += Math.cos((i / 16) * (Math.PI / 2)) ** 2 * Math.max(0, freq[i] - prev[i]) / 255
      }
      prev.set(freq)
      peak = Math.max(flux, peak * 0.996, 0.05)
      lvl = Math.max(lvl * settingsRef.current.decay, flux / peak)
      card.style.setProperty('--p', Math.min(1.5, lvl * settingsRef.current.react).toFixed(3))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      card.style.setProperty('--p', '0')
    }
  }, [playing, currentId, tracks, getAnalyser])

  /* wheel: a native non-passive listener, so a trackpad flick moves the ring
     instead of scrolling the page underneath it */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (editingRef.current) return
      if ((e.target as HTMLElement | null)?.closest('[data-cyl-ui]')) return
      e.preventDefault()
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      targetRef.current += d / (layoutRef.current.cardW * 2.4)
      kickRef.current()
      window.clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(() => {
        targetRef.current = Math.round(targetRef.current)
        kickRef.current()
      }, 140)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimerRef.current)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing || e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-cyl-ui]')) return
    dragRef.current = { x: e.clientX, start: targetRef.current, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    if (!drag.moved && Math.abs(dx) < 6) return
    if (!drag.moved) e.currentTarget.setPointerCapture(e.pointerId)
    drag.moved = true
    targetRef.current = drag.start - dx / (layoutRef.current.cardW * 1.55)
    kickRef.current()
  }

  const endDrag = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.moved) {
      suppressClickRef.current = true
      targetRef.current = Math.round(targetRef.current)
      kickRef.current()
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('input,textarea,select')) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      targetRef.current = Math.round(targetRef.current) + (e.key === 'ArrowRight' ? 1 : -1)
      kickRef.current()
      return
    }
    /* Enter/Space on a card is the card's own click — only handle them when
       the ring itself has focus, so one press never plays twice */
    if (target.closest('button')) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      const item = tracks[wrap(Math.round(posRef.current), tracks.length)]
      if (item) (item.id === currentId ? onToggle : () => onPlay(item.id))()
    }
  }

  const choose = (index: number) => {
    if (editing || suppressClickRef.current) return
    const item = tracks[index]
    if (!item) return
    goTo(index)
    if (item.id === currentId) onToggle()
    else onPlay(item.id)
  }

  const status = (index: number) => {
    const t = tracks[index]
    if (!t) return ''
    if (t.id === currentId) return playing ? 'Now playing' : 'Paused'
    return `#${index + 1}`
  }

  const rootStyle = {
    '--cyl-fill': settings.fill,
    '--cyl-blur': `${settings.blur}px`,
  } as React.CSSProperties

  return (
    <div ref={rootRef} className="cyl-widget" style={rootStyle}>
      <div className="cyl-head">
        <div className="cyl-head-actions">
          {editing && (
            <button
              type="button"
              data-cyl-ui
              className={`cyl-gear${gearOpen ? ' is-on' : ''}`}
              aria-label="Carousel settings"
              aria-expanded={gearOpen}
              title="Carousel settings"
              onClick={() => setGearOpen((v) => !v)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <SlidersHorizontal size={12} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={stageRef}
        className="cyl-stage"
        role="listbox"
        aria-label="Songs"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {tracks.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              cardsRef.current[i] = el
            }}
            type="button"
            role="option"
            aria-selected={i === focusedIndex}
            aria-label={`${t.title} by ${t.artist}${t.id === currentId ? playing ? ', now playing' : ', paused' : ''}`}
            className={`cyl-card${i === focusedIndex ? ' is-focused' : ''}`}
            onClick={() => choose(i)}
          >
            <span className="cyl-art">
              {t.cover ? <img src={t.cover} alt="" draggable={false} /> : <span>{t.title.trim().charAt(0).toUpperCase() || '?'}</span>}
            </span>
            <span className="cyl-tx">
              <small>{status(i)}</small>
              <strong>{t.title}</strong>
              <em>{t.artist}</em>
              <span className="cyl-cta">
                {t.id === currentId ? (playing ? 'Click to pause' : 'Click to play') : 'Click to play'}
                <i>
                  <b />
                </i>
              </span>
            </span>
          </button>
        ))}
        {!tracks.length && <div className="cyl-empty">NO TRACKS ON THIS LIST</div>}
      </div>

      {editing && gearOpen && (
        <div
          className="cyl-cfg"
          data-cyl-ui
          role="dialog"
          aria-label="Carousel settings"
          /* the settings popover owns its pointer: a press on a slider (or
             anywhere in this card) is an adjustment, never a drag of the
             carousel frame or the ring behind it */
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <div className="cyl-cfg-head">
            <span>CAROUSEL</span>
            <button type="button" aria-label="Close carousel settings" onClick={() => setGearOpen(false)}>
              <X size={11} />
            </button>
          </div>
          <div className="cyl-cfg-body">
            {SLIDERS.map(({ key, label, min, max, step }) => (
              <label key={key} className="cyl-ctl">
                <span>{label}</span>
                <output>{settings[key].toFixed(key === 'perspective' || key === 'yaw' || key === 'blur' ? 0 : 2)}</output>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={settings[key]}
                  /* stopPropagation on both phases: in edit mode a slider
                     press must not start the LayoutFrame's move gesture, and
                     the change must not bubble into any surface handler */
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation()
                    const value = Number(e.target.value)
                    setSettings((cur) => ({ ...cur, [key]: value }))
                    kickRef.current()
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
