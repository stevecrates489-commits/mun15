import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ArrowLeftRight, BookmarkPlus, Check, Pencil } from 'lucide-react'
import {
  hexToHsv,
  hsvToCss,
  hsvToHex8,
  gradientCss,
  DEFAULT_WALL_GRADIENT,
  type Hsv,
  type Paint,
} from '../lib/color'

interface Props {
  paint: Paint
  onChange: (next: Paint) => void
  onClose: () => void
}

/* ---- saved gradient presets ----
   Named snapshots of the whole gradient (both stops + the angle), kept in
   localStorage beside the player's other display choices. Applying one
   replaces the current gradient wholesale; renaming is inline. */
interface GradientPreset {
  id: string
  name: string
  gradient: { from: Hsv; to: Hsv; angle: number }
}

const PRESETS_KEY = 'md-wall-gradient-presets'

function readPresets(): GradientPreset[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (p): p is GradientPreset =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as GradientPreset).id === 'string' &&
        typeof (p as GradientPreset).name === 'string' &&
        !!(p as GradientPreset).gradient,
    )
  } catch {
    return []
  }
}

function writePresets(list: GradientPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list))
  } catch {
    /* private mode — the list lasts for this session */
  }
}

/* which end of the gradient the colour axes are editing */
type Stop = 'from' | 'to'

/* The three gradient widgets are the HSV axes: the square is saturation
   (x) against value (y) at the current hue, the strip is hue, the second
   strip is alpha over a checkerboard. Dragging any of them captures on
   pointerdown and follows on window pointermove, so a fast drag that leaves
   the widget keeps tracking instead of stopping at its edge.

   In GRADIENT mode the same three widgets edit the SELECTED STOP (A or B)
   instead of a single colour — one picker, two shapes of wallpaper. */
export default function ColorPicker({ paint, onChange, onClose }: Props) {
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const alphaRef = useRef<HTMLDivElement>(null)
  /* the hex field is local text: it must let a half-typed value sit there
     without the drag handler rewriting it, and only commit on blur/Enter */
  const [hexText, setHexText] = useState(() => hsvToHex8(paint.kind === 'solid' ? paint.color : paint.gradient.from))

  const isGradient = paint.kind === 'gradient'
  const grad = paint.kind === 'gradient' ? paint.gradient : null
  const solid = paint.kind === 'solid' ? paint.color : null

  /* the stop the axes edit — only meaningful in gradient mode */
  const [stop, setStop] = useState<Stop>('from')

  /* the colour the axes are editing right now: stop A/B in gradient mode,
     the flat colour in solid mode. Both come straight out of `paint`, so
     this is a stable reference between renders. */
  const value: Hsv = grad ? (stop === 'from' ? grad.from : grad.to) : (solid as Hsv)

  useEffect(() => {
    setHexText(hsvToHex8(value))
  }, [value])

  /* write the edited colour back into whichever shape of paint is active */
  const setValue = useCallback(
    (next: Hsv) => {
      if (grad) {
        onChange({
          kind: 'gradient',
          gradient: stop === 'from' ? { ...grad, from: next } : { ...grad, to: next },
        })
      } else if (solid) {
        onChange({ kind: 'solid', color: next })
      }
    },
    [grad, solid, stop, onChange],
  )

  /* mode switch — a CONVERSION, never a reset: the flat colour becomes the
     first stop, and switching back keeps the first stop as the flat colour */
  const setMode = useCallback(
    (kind: 'solid' | 'gradient') => {
      if (kind === 'solid') {
        onChange({ kind: 'solid', color: grad ? grad.from : (solid as Hsv) })
        return
      }
      onChange({
        kind: 'gradient',
        gradient: grad ?? {
          from: (solid as Hsv),
          to: DEFAULT_WALL_GRADIENT.to,
          angle: DEFAULT_WALL_GRADIENT.angle,
        },
      })
    },
    [grad, solid, onChange],
  )

  /* ---- the saved presets ---- */
  const [presets, setPresets] = useState<GradientPreset[]>(readPresets)
  const [naming, setNaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const savePreset = () => {
    if (!grad) return
    const name = nameDraft.trim() || `GRADIENT ${presets.length + 1}`
    const preset: GradientPreset = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      name,
      gradient: { ...grad },
    }
    const next = [preset, ...presets].slice(0, 40)
    setPresets(next)
    writePresets(next)
    setNaming(false)
    setNameDraft('')
  }
  const commitRename = (id: string) => {
    const name = renameDraft.trim()
    if (name) {
      const next = presets.map((p) => (p.id === id ? { ...p, name } : p))
      setPresets(next)
      writePresets(next)
    }
    setRenamingId(null)
  }
  const applyPreset = (p: GradientPreset) => {
    onChange({ kind: 'gradient', gradient: { ...p.gradient } })
  }

  /* the two stops trade places — the angle stays, so the picture is mirrored
     along the same axis instead of turning into a different one */
  const swapStops = useCallback(() => {
    if (!grad) return
    onChange({ kind: 'gradient', gradient: { ...grad, from: grad.to, to: grad.from } })
  }, [grad, onChange])

  const setAngle = useCallback(
    (angle: number) => {
      if (!grad) return
      onChange({ kind: 'gradient', gradient: { ...grad, angle } })
    },
    [grad, onChange],
  )

  /* closing must COMMIT the hex field first. Unmounting an input never fires
     blur, so a typed value used to vanish with the card — which reads exactly
     like "my colour was not saved". Every exit path goes through here. */
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const commitDraft = useCallback(() => {
    if (hexDraft == null) return
    const parsed = hexToHsv(hexDraft)
    if (parsed) setValue(parsed)
  }, [hexDraft, setValue])
  const close = useCallback(() => {
    commitDraft()
    onClose()
  }, [commitDraft, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  const dragOn = useCallback(
    (
      el: HTMLElement | null,
      e: React.PointerEvent,
      apply: (x: number, y: number, w: number, h: number) => void,
    ) => {
      if (!el) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const move = (ev: PointerEvent) =>
        apply(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height)
      move(e.nativeEvent)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [],
  )

  const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

  const commitHex = (raw: string) => {
    const parsed = hexToHsv(raw)
    if (parsed) setValue(parsed)
    else setHexText(hsvToHex8(value))
    setHexDraft(null)
  }

  return (
    <div
      className="pop-in max-h-[calc(100vh-24px)] w-[264px] overflow-y-auto overscroll-contain rounded-2xl border border-white/12 bg-[#0c0c11]/95 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-md"
      role="dialog"
      aria-label="Wallpaper colour"
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">
          WALLPAPER {isGradient ? 'GRADIENT' : 'COLOUR'}
        </span>
        <button
          onClick={close}
          aria-label="Close colour picker"
          className="grid h-5 w-5 place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
        >
          <X size={11} />
        </button>
      </div>

      {/* SOLID ⇄ GRADIENT — the same picker paints either shape */}
      <div className="mb-2.5 grid grid-cols-2 gap-1">
        {(['solid', 'gradient'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={(m === 'gradient') === isGradient}
            className={`rounded-lg py-1 font-mono text-[8px] tracking-[0.18em] transition ${
              (m === 'gradient') === isGradient
                ? 'bg-white/90 text-black'
                : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
            }`}
          >
            {m === 'solid' ? 'SOLID' : 'GRADIENT'}
          </button>
        ))}
      </div>

      {/* the live preview — the flat colour in solid mode, the real gradient
          in gradient mode. It is the wallpaper itself, at card size */}
      <div
        aria-hidden
        className="mb-2.5 h-8 w-full rounded-lg border border-white/12"
        style={{ background: isGradient && grad ? gradientCss(grad) : hsvToCss(value) }}
      />

      {isGradient && grad && (
        <>
          {/* the two stops, and the button that trades them */}
          <div className="mb-2 flex items-center gap-1.5">
            {(['from', 'to'] as const).map((s) => {
              const c = s === 'from' ? grad.from : grad.to
              return (
                <button
                  key={s}
                  onClick={() => setStop(s)}
                  aria-pressed={stop === s}
                  title={s === 'from' ? 'Gradient start colour' : 'Gradient end colour'}
                  className={`flex flex-1 items-center gap-1.5 rounded-lg border px-2 py-1 transition ${
                    stop === s
                      ? 'border-white/60 bg-white/10'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-white/30"
                    style={{ background: hsvToCss(c) }}
                  />
                  <span className="font-mono text-[8px] tracking-[0.15em] text-white/60">
                    {s === 'from' ? 'A' : 'B'}
                  </span>
                </button>
              )
            })}
            <button
              onClick={swapStops}
              aria-label="Swap gradient stops"
              title="Swap the two stops"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-white/10 text-white/40 transition hover:border-white/30 hover:text-white"
            >
              <ArrowLeftRight size={10} />
            </button>
          </div>

          {/* the gradient's direction */}
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">ANGLE</span>
            <span className="font-mono text-[8px] text-white/40">{Math.round(grad.angle)}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={grad.angle}
            onChange={(e) => setAngle(Number(e.target.value))}
            aria-label="Gradient angle"
            className="chrome-range mb-2.5 w-full"
          />

          {/* save the gradient as it stands, under a name of the user's own */}
          <div className="mb-2.5">
            {naming ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      savePreset()
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setNaming(false)
                      setNameDraft('')
                    }
                  }}
                  placeholder="NAME THIS GRADIENT"
                  spellCheck={false}
                  aria-label="Gradient preset name"
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 font-mono text-[9px] tracking-[0.1em] text-white outline-none transition focus:border-white/40"
                />
                <button
                  onClick={savePreset}
                  aria-label="Save gradient preset"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-emerald-300/40 bg-emerald-400/10 text-emerald-200 transition hover:border-emerald-300/70"
                >
                  <Check size={11} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setNaming(true)
                  setNameDraft('')
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1 font-mono text-[8px] tracking-[0.18em] text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <BookmarkPlus size={10} />
                SAVE PRESET
              </button>
            )}
          </div>

          {presets.length > 0 && (
            <div className="mb-2.5 max-h-28 overflow-y-auto rounded-lg border border-white/10 pr-0.5">
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-1.5 py-1 transition hover:bg-white/5">
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/25"
                    style={{ background: gradientCss(p.gradient) }}
                  />
                  {renamingId === p.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitRename(p.id)
                          }
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => commitRename(p.id)}
                        spellCheck={false}
                        aria-label="Rename gradient preset"
                        className="min-w-0 flex-1 rounded border border-white/25 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-white outline-none focus:border-white/50"
                      />
                      <button
                        onClick={() => commitRename(p.id)}
                        aria-label="Confirm rename"
                        className="grid h-5 w-5 shrink-0 place-items-center rounded text-emerald-300 transition hover:bg-white/10"
                      >
                        <Check size={10} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => applyPreset(p)}
                        title={`Wear “${p.name}”`}
                        className="min-w-0 flex-1 truncate text-left font-mono text-[9px] tracking-[0.12em] text-white/70 transition hover:text-white"
                      >
                        {p.name}
                      </button>
                      <button
                        onClick={() => {
                          setRenamingId(p.id)
                          setRenameDraft(p.name)
                        }}
                        aria-label={`Rename ${p.name}`}
                        title="Rename"
                        className="grid h-5 w-5 shrink-0 place-items-center rounded text-white/40 transition hover:bg-white/10 hover:text-white"
                      >
                        <Pencil size={9} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* saturation × value square */}
      <div
        ref={svRef}
        onPointerDown={(e) =>
          dragOn(svRef.current, e, (x, y, w, h) =>
            setValue({ ...value, s: clamp01(x / w), v: clamp01(1 - y / h) }),
          )
        }
        className="relative h-32 w-full cursor-crosshair overflow-hidden rounded-xl"
        style={{ background: `hsl(${value.h} 100% 50%)` }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top,#000,transparent)' }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to right,#fff,transparent)' }} />
        <span
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.6)]"
          style={{ left: `${value.s * 100}%`, top: `${(1 - value.v) * 100}%`, background: hsvToCss({ ...value, a: 1 }) }}
        />
      </div>

      {/* hue strip */}
      <div
        ref={hueRef}
        onPointerDown={(e) => dragOn(hueRef.current, e, (x, _y, w) => setValue({ ...value, h: clamp01(x / w) * 359.99 }))}
        className="relative mt-2.5 h-3 w-full cursor-pointer rounded-full"
        style={{
          background:
            'linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)',
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
          style={{ left: `${(value.h / 360) * 100}%`, background: `hsl(${value.h} 100% 50%)` }}
        />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        {/* alpha strip: transparency gradient over a checkerboard */}
        <div
          ref={alphaRef}
          onPointerDown={(e) => dragOn(alphaRef.current, e, (x, _y, w) => setValue({ ...value, a: clamp01(x / w) }))}
          className="relative h-3 flex-1 cursor-pointer overflow-hidden rounded-full"
          style={{
            backgroundColor: '#1b1b22',
            backgroundImage: `linear-gradient(to right, transparent, ${hsvToCss({ ...value, a: 1 })}), repeating-conic-gradient(#3a3a44 0% 25%, #202027 0% 50%)`,
            backgroundSize: 'auto, 8px 8px',
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
            style={{ left: `${value.a * 100}%`, background: hsvToCss(value) }}
          />
        </div>
        <input
          value={hexText}
          onChange={(e) => {
            setHexText(e.target.value)
            setHexDraft(e.target.value)
          }}
          onBlur={() => commitHex(hexText)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitHex(hexText)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          spellCheck={false}
          aria-label="Hex colour"
          className="w-[92px] shrink-0 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-right font-mono text-[10px] uppercase tracking-wider text-white outline-none transition focus:border-white/40"
        />
      </div>
    </div>
  )
}
