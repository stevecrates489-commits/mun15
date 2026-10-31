/**
 * Butterchurn — MilkDrop, running in WebGL, on the deck's own audio.
 *
 * This one is different from every other style here in one way that matters:
 * it does not paint from the AudioFrame. Butterchurn reads a live AudioNode
 * itself, so the module taps the deck's analyser through a private gain (its
 * output is muted into the destination, exactly like the app's other taps)
 * and lets Butterchurn drive its own mixer. The shared SENSITIVITY slider is
 * wired to that tap's gain, so it is the one of the four shared settings that
 * does anything here; the visual's own card carries the preset controls.
 *
 * Both packages are loaded on demand: Butterchurn plus its preset packs are
 * far heavier than every other visual combined, and nobody should pay for
 * them by opening the player.
 */
import { useEffect, useRef, useState } from 'react'
import { FolderUp, Star, Trash2 } from 'lucide-react'
import type { OverlayProps, VisualizerFactory } from '../runtime-types'
import { deleteCustomBcPreset, listCustomBcPresets, saveCustomBcPreset } from '../../../lib/library'

type ButterApi = {
  presets(): string[]
  state(): { preset: string; cycle: number; random: boolean }
  setPreset(name: string): void
  next(): void
  prev(): void
  setCycle(seconds: number): void
  setRandom(on: boolean): void
  isFav(name: string): boolean
  toggleFav(name: string): boolean
  hide(name: string): void
  /* custom .milk presets — converted in the browser, kept in IndexedDB */
  importMilk(text: string, baseName: string): Promise<{ name: string; error?: string }>
  deleteCustom(name: string): Promise<void>
  isCustom(name: string): boolean
}

/* the preset manager's memory: favourites are marked, hidden presets are out
   of the rotation. Both survive a restart the same way the panel's toggles
   do — localStorage, read before the first preset is picked. */
const FAVS_KEY = 'md-bc-favs'
const HIDDEN_KEY = 'md-bc-hidden'

function readList(key: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeList(key: string, list: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...list]))
  } catch {
    /* private mode — the choice lasts for this session */
  }
}

/** The packs wrap themselves in a UMD default; unwrap whatever shape arrives. */
function presetsFrom(mod: unknown): Record<string, object> {
  let bag = ((mod as { default?: unknown }).default ?? mod) as Record<string, object>
  const inner = (bag as unknown as { default?: unknown }).default
  if (inner && typeof inner === 'object') bag = inner as Record<string, object>
  return bag
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

const ButterchurnViz: VisualizerFactory = async ({
  container,
  width,
  height,
  dpr,
  analyser,
  getAnalyser,
}) => {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  container.appendChild(canvas)

  const [{ default: Butterchurn }, presetsModule] = await Promise.all([
    import('butterchurn'),
    import('butterchurn-presets'),
  ])

  const presets = presetsFrom(presetsModule)
  if (!Object.keys(presets).length) throw new Error('the preset pack came back empty')

  /* custom presets: .milk files the user imported, converted to Butterchurn's
     JSON in the browser and kept in IndexedDB — they survive a restart like
     the stock pack does not need to (it ships with the app). */
  const customs = new Map<string, object>()
  try {
    for (const c of await listCustomBcPresets()) customs.set(c.name, c.preset as object)
  } catch {
    /* private mode / unreachable store — this session runs on the stock pack */
  }

  const favs = readList(FAVS_KEY)
  const hidden = readList(HIDDEN_KEY)
  /* the rotation: everything the pack ships plus the imported presets,
     minus the ones hidden here */
  const rebuildPool = () =>
    [...Object.keys(presets), ...customs.keys()]
      .filter((n) => !hidden.has(n))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  let pool = rebuildPool()
  if (!pool.length) {
    /* a hidden list that covers everything would blank the screen — drop it */
    hidden.clear()
    writeList(HIDDEN_KEY, hidden)
    pool = rebuildPool()
  }
  const getPreset = (name: string): object | undefined =>
    customs.get(name) ?? presets[name]

  const size = {
    width: Math.max(1, width),
    height: Math.max(1, height),
    dpr: Math.min(2, dpr),
  }

  let visualizer: ReturnType<typeof Butterchurn.createVisualizer> | null = null
  let tap: GainNode | null = null
  let mute: GainNode | null = null
  let index = Math.floor(Math.random() * pool.length)
  let cycle = 15
  let random = true
  let elapsed = 0
  const history: number[] = []
  let disposed = false

  const load = (next: number, blend = 5.7) => {
    index = ((next % pool.length) + pool.length) % pool.length
    if (!visualizer) return
    const preset = getPreset(pool[index])
    if (!preset) return
    try {
      /* beta.5's loadPreset is async (the WASM path compiles at load) —
         a rejection must not become an unhandled one */
      const r = visualizer.loadPreset(preset, blend) as unknown
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        ;(r as Promise<unknown>).then(undefined, () => {
          /* a preset the renderer cannot compile — keep the previous picture */
        })
      }
    } catch {
      /* a preset the renderer cannot compile — keep the previous picture */
    }
  }

  /* The deck builds its audio graph on the FIRST PLAY, so this visual is
     usually picked before there is anything to listen to. Build once the
     analyser exists instead of failing at mount: the canvas is already up and
     starts moving on the next frame after playback begins. */
  const build = (an: AnalyserNode) => {
    const context = an.context as AudioContext
    tap = context.createGain()
    tap.gain.value = 1
    mute = context.createGain()
    mute.gain.value = 0
    try {
      an.connect(tap)
      tap.connect(mute)
      mute.connect(context.destination)
    } catch {
      /* an already-closed context — Butterchurn will simply read silence */
    }
    visualizer = Butterchurn.createVisualizer(context, canvas, {
      width: size.width,
      height: size.height,
      pixelRatio: size.dpr,
      textureRatio: 1,
    })
    try {
      visualizer.connectAudio(tap)
    } catch {
      /* nothing to connect to — it renders black until the next build */
    }
    load(index, 0)
  }

  const opening = analyser ?? getAnalyser?.() ?? null
  if (opening) build(opening)

  const next = (blend = 5.7) => {
    history.push(index)
    if (history.length > 32) history.shift()
    load(random ? Math.floor(Math.random() * pool.length) : index + 1, blend)
  }

  const prev = (blend = 5.7) => {
    load(history.length ? (history.pop() as number) : index - 1, blend)
  }

  const api: ButterApi = {
    presets: () => pool,
    state: () => ({ preset: pool[index] ?? '', cycle, random }),
    setPreset(name: string) {
      const at = pool.indexOf(name)
      if (at >= 0) {
        history.push(index)
        load(at)
      }
    },
    next: () => next(),
    prev: () => prev(),
    setCycle(seconds: number) {
      cycle = clamp(Number.isFinite(seconds) ? seconds : 0, 0, 600)
      elapsed = 0
    },
    setRandom(on: boolean) {
      random = !!on
    },
    isFav: (name: string) => favs.has(name),
    toggleFav(name: string) {
      if (favs.has(name)) favs.delete(name)
      else favs.add(name)
      writeList(FAVS_KEY, favs)
      return favs.has(name)
    },
    hide(name: string) {
      const at = pool.indexOf(name)
      if (at < 0) return
      hidden.add(name)
      writeList(HIDDEN_KEY, hidden)
      pool = pool.filter((n) => n !== name)
      if (!pool.length) {
        /* hiding the last preset left would blank the screen — put it back */
        hidden.delete(name)
        writeList(HIDDEN_KEY, hidden)
        pool = rebuildPool()
        return
      }
      const wasCurrent = at === index
      index = Math.max(0, Math.min(pool.length - 1, index > at ? index - 1 : index))
      /* a deleted preset that was on screen hands over to another one */
      if (wasCurrent) next(0)
    },
    isCustom: (name: string) => customs.has(name),
    importMilk: async (text: string, baseName: string) => {
      try {
        /* the converter (~780 KB with its shader translator) is lazy — this
           chunk exists only for the session that actually imports a .milk.
           It is a UMD bundle: depending on the interop it lands as the
           import's default, its own namespace, or the window global. */
        const convMod = (await import('milkdrop-preset-converter')) as unknown as Record<string, unknown>
        const conv =
          ((convMod as { default?: Record<string, unknown> }).default ??
            (typeof convMod.convertPreset === 'function'
              ? convMod
              : (globalThis as { milkdropPresetConverter?: Record<string, unknown> })
                  .milkdropPresetConverter) ??
          {}) as { convertPreset?: (t: string) => Promise<Record<string, unknown> & { presetParts?: unknown }> }
        if (typeof conv.convertPreset !== 'function') throw new Error('THE CONVERTER DID NOT LOAD')
        const raw = await conv.convertPreset(text)
        if (!raw || typeof raw !== 'object') throw new Error('THE CONVERTER CAME BACK EMPTY')
        /* presetParts is the converter's debug echo — not loadable data */
        const preset = { ...raw } as Record<string, unknown>
        delete preset.presetParts
        /* a name unique across stock and custom presets */
        let name = baseName
        let n = 2
        while (customs.has(name) || presets[name]) name = `${baseName} (${n++})`
        await saveCustomBcPreset(name, preset)
        customs.set(name, preset)
        pool = rebuildPool()
        const at = pool.indexOf(name)
        if (at >= 0) {
          history.push(index)
          load(at, 0)
        }
        return { name }
      } catch (e) {
        /* unsupported HLSL, a corrupt file, a converter blow-up — the message
           is for the card, the console keeps the detail */
        console.error('[butterchurn] .milk conversion failed:', e)
        return { name: baseName, error: e instanceof Error ? e.message : String(e) }
      }
    },
    deleteCustom: async (name: string) => {
      if (!customs.has(name)) return
      const nextPool = rebuildPool().filter((n) => n !== name)
      if (!nextPool.length) {
        /* the only preset left (stock all hidden) — refuse rather than blank */
        pool = rebuildPool()
        return
      }
      customs.delete(name)
      await deleteCustomBcPreset(name)
      const at = pool.indexOf(name)
      pool = nextPool
      const wasCurrent = at === index
      index = Math.max(0, Math.min(pool.length - 1, index > at ? index - 1 : index))
      if (wasCurrent) next(0)
    },
  }

  return {
    resize(w, h, pr) {
      size.width = Math.max(1, w)
      size.height = Math.max(1, h)
      size.dpr = Math.min(2, pr)
      visualizer?.setRendererSize(size.width, size.height, {
        pixelRatio: size.dpr,
        textureRatio: 1,
      })
    },

    frame({ settings, dt }) {
      if (disposed) return
      /* still no audio graph? try again each frame until the deck has one */
      if (!visualizer) {
        const an = getAnalyser?.() ?? null
        if (!an) return
        build(an)
        if (!visualizer) return
      }
      if (tap) tap.gain.value = clamp(settings.sensitivity, 0.1, 3)
      if (cycle > 0) {
        elapsed += dt
        if (elapsed >= cycle) {
          elapsed = 0
          next(2.7)
        }
      }
      try {
        visualizer.render()
      } catch {
        /* a preset that will not compile must not take the backdrop down */
      }
    },

    dispose() {
      disposed = true
      const an = getAnalyser?.() ?? null
      try {
        if (visualizer && tap) visualizer.disconnectAudio(tap)
      } catch {
        /* already gone */
      }
      try {
        visualizer?.dispose?.()
      } catch {
        /* already gone */
      }
      try {
        if (an && tap) an.disconnect(tap)
        tap?.disconnect()
        mute?.disconnect()
      } catch {
        /* already gone */
      }
      canvas.width = canvas.height = 0
      canvas.remove()
    },

    api: api as unknown as Record<string, (...args: never[]) => unknown>,
  }
}

export default ButterchurnViz

/* ---- its own settings card ------------------------------------------- */

const field =
  'h-6 min-w-0 rounded-md border border-white/15 bg-white/[0.06] px-2 font-mono text-[9px] tracking-[0.12em] text-white/80 outline-none transition hover:border-white/35 focus-visible:border-white/45'
const stepBtn =
  'grid h-6 w-6 place-items-center rounded-md border border-white/15 bg-white/[0.06] text-[11px] leading-none text-white/70 transition hover:border-white/40 hover:text-white'
const check = 'h-3 w-3 accent-emerald-400'
const iconBtn =
  'grid h-6 w-6 place-items-center rounded-md border border-white/15 bg-white/[0.06] transition hover:border-white/40'

export function Overlay({ api }: OverlayProps) {
  const viz = api as unknown as ButterApi | null
  const names = viz?.presets() ?? []
  const initial = viz?.state()
  const [preset, setPreset] = useState(initial?.preset ?? names[0] ?? '')
  /* the toggles remember themselves: they are display choices, and a refresh
     putting AUTO-CYCLE back on after the user turned it off reads as the
     panel ignoring them */
  const [cycle, setCycle] = useState(() => {
    const saved = Number(localStorage.getItem('md-bc-cycle'))
    return Number.isFinite(saved) && saved >= 0 ? Math.min(600, Math.round(saved)) : (initial?.cycle ?? 15)
  })
  const [random, setRandom] = useState(() => localStorage.getItem('md-bc-random') !== '0')
  /* bumped when the rotation changes, so the picker re-reads the pool */
  const [, setVersion] = useState(0)
  /* derived, not synced: the star is whatever the module says about the
     preset on screen right now — including auto-cycle's own picks — and the
     version bump re-renders after the module's set changes */
  const [, setFavVersion] = useState(0)
  const fav = viz?.isFav(preset) ?? false
  /* collapsed until asked for: the card sits over the panel's own controls */
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem('md-bc-cycle', String(cycle))
    } catch {
      /* private mode — the choice lasts for this session */
    }
    viz?.setCycle(cycle)
  }, [viz, cycle])
  useEffect(() => {
    try {
      localStorage.setItem('md-bc-random', random ? '1' : '0')
    } catch {
      /* private mode — the choice lasts for this session */
    }
    viz?.setRandom(random)
  }, [viz, random])

  const pick = (name: string) => {
    setPreset(name)
    viz?.setPreset(name)
  }
  const step = (dir: number) => {
    viz?.[dir > 0 ? 'next' : 'prev']()
    /* the module is the source of truth for what is on screen */
    const now = viz?.state().preset
    if (now) setPreset(now)
  }
  const toggleFav = () => {
    if (!viz || !preset) return
    viz.toggleFav(preset)
    setFavVersion((v) => v + 1)
  }
  const hideCurrent = () => {
    if (!viz || !preset) return
    /* a custom preset leaves for good; a stock one is only hidden from the
       rotation (the pack itself stays on disk) */
    if (viz.isCustom(preset)) {
      void viz.deleteCustom(preset).then(() => {
        const now = viz.state().preset
        if (now) setPreset(now)
        setVersion((v) => v + 1)
      })
      return
    }
    viz.hide(preset)
    const now = viz.state().preset
    if (now) setPreset(now)
    setVersion((v) => v + 1)
  }

  /* ---- .milk import: converted in the browser, kept in IndexedDB ---- */
  const milkRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const [importMsg, setImportMsg] = useState('')
  const importMilk = async (file: File | null | undefined) => {
    if (!file || !viz) return
    const base = file.name.replace(/\.milk$/i, '') || 'IMPORTED'
    /* the shader translation of a big preset can take seconds — say so */
    setImportState('busy')
    setImportMsg(`CONVERTING ${base.toUpperCase()}…`)
    const res = await viz.importMilk(await file.text(), base)
    if (res.error) {
      setImportState('error')
      setImportMsg(`COULD NOT CONVERT — ${res.error.slice(0, 60).toUpperCase()}`)
      return
    }
    setImportState('ok')
    setImportMsg(`IMPORTED “${res.name.toUpperCase()}”`)
    setPreset(res.name)
    setVersion((v) => v + 1)
    window.setTimeout(() => setImportState('idle'), 5000)
  }

  return (
    <div className="absolute bottom-3 right-3 z-20 w-[268px] max-w-[calc(100%-1.5rem)]">
      {open && (
        <div className="mb-2 flex flex-col gap-2 rounded-xl border border-white/15 bg-black/70 p-2.5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[7px] tracking-[0.2em] text-white/40">BUTTERCHURN</span>
            <span className="font-mono text-[7px] tracking-[0.15em] text-white/30">
              {names.length} PRESETS
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button className={stepBtn} onClick={() => step(-1)} aria-label="Previous preset">
              ‹
            </button>
            <select
              value={preset}
              onChange={(e) => pick(e.target.value)}
              aria-label="Butterchurn preset"
              className={`${field} flex-1 truncate`}
              style={{ colorScheme: 'dark' }}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {`${viz?.isCustom(n) ? '◆ ' : ''}${n}`}
                </option>
              ))}
            </select>
            <button className={stepBtn} onClick={() => step(1)} aria-label="Next preset">
              ›
            </button>
          </div>

          {/* .milk import — MilkDrop presets, converted in the browser.
              One at a time on purpose: the shader translation is heavy. */}
          <input
            ref={milkRef}
            type="file"
            accept=".milk,text/plain"
            className="hidden"
            onChange={(e) => {
              void importMilk(e.target.files?.[0])
              /* allow re-picking the same file */
              e.target.value = ''
            }}
          />
          <div className="flex items-center justify-between gap-2 font-mono text-[8px] tracking-[0.15em] text-white/45">
            IMPORT .MILK
            <button
              onClick={() => milkRef.current?.click()}
              disabled={importState === 'busy'}
              title="Convert a MilkDrop preset and add it to the rotation"
              className={`${iconBtn} text-white/50 hover:text-white disabled:opacity-40`}
              aria-label="Import a MilkDrop preset file"
            >
              {importState === 'busy' ? (
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/80" />
              ) : (
                <FolderUp size={11} />
              )}
            </button>
          </div>
          {importState !== 'idle' && (
            <div
              className={`font-mono text-[7px] leading-relaxed tracking-[0.12em] ${
                importState === 'error' ? 'text-rose-300/80' : importState === 'ok' ? 'text-emerald-300/80' : 'text-white/45'
              }`}
            >
              {importMsg}
            </div>
          )}

          <label className="flex items-center justify-between gap-2 font-mono text-[8px] tracking-[0.15em] text-white/45">
            AUTO-CYCLE
            <span className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={cycle > 0}
                onChange={(e) => setCycle(e.target.checked ? 15 : 0)}
                className={check}
                aria-label="Cycle presets automatically"
              />
              <input
                type="number"
                min={1}
                max={600}
                value={Math.max(1, Math.round(cycle))}
                onChange={(e) => setCycle(clamp(Number(e.target.value) || 0, 0, 600))}
                className={`${field} w-12 tabular-nums`}
                aria-label="Seconds per preset"
              />
              <span className="text-white/30">s</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 font-mono text-[8px] tracking-[0.15em] text-white/45">
            RANDOM NEXT
            <input
              type="checkbox"
              checked={random}
              onChange={(e) => setRandom(e.target.checked)}
              className={check}
              aria-label="Pick the next preset at random"
            />
          </label>

          {/* the preset manager: save the one on screen, or take it out of
              the rotation — both survive a restart */}
          <div className="flex items-center justify-between gap-2 font-mono text-[8px] tracking-[0.15em] text-white/45">
            PRESET
            <span className="flex items-center gap-1">
              <button
                onClick={toggleFav}
                aria-pressed={fav}
                aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
                title={fav ? 'Favourited' : 'Save this preset'}
                className={`${iconBtn} ${fav ? 'text-amber-300' : 'text-white/50 hover:text-white'}`}
              >
                <Star size={11} className={fav ? 'fill-amber-300' : ''} />
              </button>
              <button
                onClick={hideCurrent}
                aria-label={viz?.isCustom(preset) ? 'Delete imported preset' : 'Delete preset from rotation'}
                title={viz?.isCustom(preset) ? 'Delete this imported preset for good' : 'Remove this preset from the rotation'}
                className={`${iconBtn} text-white/50 hover:border-rose-300/50 hover:text-rose-300`}
              >
                <Trash2 size={11} />
              </button>
            </span>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 font-mono text-[8px] tracking-[0.18em] text-white/60 transition hover:border-white/40 hover:text-white"
      >
        BUTTERCHURN
      </button>
    </div>
  )
}
