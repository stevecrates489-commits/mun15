import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { visualizers as VOLT_STYLES } from '../features/voltviz/registry'
import { loadVisualizer } from '../features/voltviz/modules'
import { VOLT_SETTINGS_DEFAULT, VOLT_SETTING_RANGE } from '../features/voltviz/useVoltViz'
import type { VisualizerSettings } from '../features/voltviz/settings'
import type { VisualizerModule } from '../features/voltviz/runtime-types'

interface Props {
  /** the live backdrop's style id, or null for none */
  volt: string | null
  onVolt: (id: string | null) => void
  /** the selected visual's own tuning — VoltViz's four settings, stored per style */
  settings: VisualizerSettings
  onSetting: (key: keyof VisualizerSettings, value: number) => void
  /** the mounted visual's own settings card api, when its module has one */
  api: Record<string, (...args: never[]) => unknown> | null
  /** the state of the player's own audio graph */
  audioState?: string | null
  /** HIDE UI — chrome out, visual on screen (also bound to H) */
  onHideUi: () => void
  onClose: () => void
}

/** VoltViz's tuning sliders, with the labels and suffixes its own panel gives
 *  them. HUE is deliberately not offered: the palettes carry the colour
 *  identity, and a hue slider over them read as clutter (the setting itself
 *  stays in the settings type for the visuals that compute with it). */
const TUNING = [
  ['sensitivity', 'SENSITIVITY', 'x'],
  ['speed', 'SPEED', 'x'],
  ['scale', 'SCALE', 'x'],
] as const satisfies readonly (readonly [keyof VisualizerSettings, string, string])[]

const shown = (_key: keyof VisualizerSettings, value: number) => `${value.toFixed(1)}x`

/**
 * Which of the shared four actually reach the selected visual. Butterchurn
 * mixes its own audio from the deck's node, so only SENSITIVITY (the gain on
 * that tap) moves it — showing it three dead sliders would be worse than
 * showing it one that works.
 */
const tuningFor = (style: string | null) =>
  style === 'butterchurn' ? TUNING.filter(([key]) => key === 'sensitivity') : TUNING

/**
 * The visualiser's controls: the live visuals and their settings.
 *
 * What is behind the player is one of VoltViz's styles reading the deck's
 * own analyser, or nothing at all. The style is picked here, and each style
 * is tuned here: VoltViz's own four settings (its README's ranges and
 * defaults), remembered PER STYLE — plus the visual's own settings card when
 * its module brings one (VoltViz's Overlay: Halftone Pulse's Mode, Shape,
 * Colours and Image, for instance).
 */
export default function VisualizerPanel({
  volt,
  onVolt,
  settings,
  onSetting,
  api,
  audioState,
  onHideUi,
  onClose,
}: Props) {
  const [closing, setClosing] = useState(false)

  /* The selected visual's own settings card, when its module exports one.
     Loaded through the same lazy loader the backdrop uses, so the module is
     already in memory by the time the card renders. */
  const [OwnCard, setOwnCard] = useState<VisualizerModule['Overlay'] | null>(null)
  useEffect(() => {
    let live = true
    const entry = volt ? VOLT_STYLES.find((v) => v.id === volt) : undefined
    if (!entry) {
      setOwnCard(null)
      return
    }
    setOwnCard(null)
    loadVisualizer(entry)
      .then((mod) => {
        if (live) setOwnCard(() => mod.Overlay ?? null)
      })
      .catch(() => {
        if (live) setOwnCard(null)
      })
    return () => {
      live = false
    }
  }, [volt])

  const name = volt ? (VOLT_STYLES.find((v) => v.id === volt)?.name ?? volt) : ''

  return (
    <div
      className={`settings-panel fx-blur fixed left-[5%] top-[4.5rem] z-[89] flex max-h-[min(70vh,560px)] w-[min(88vw,460px)] flex-col rounded-2xl border border-white/20 bg-black/75 shadow-[0_24px_70px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl${
        closing ? ' is-closing' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">VISUALISER</span>
        <div className="flex items-center gap-2">
          {/* the option lives here because it only EXISTS while a visual is
              on — same rule as the H key it mirrors */}
          {volt && (
            <button
              onClick={onHideUi}
              title="Hide every panel, button and header — press H to bring them back"
              className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[8px] tracking-[0.15em] text-white/50 transition hover:border-white/40 hover:text-white"
            >
              HIDE UI · H
            </button>
          )}
          <button
            onClick={() => {
              setClosing(true)
              window.setTimeout(onClose, 200)
            }}
            aria-label="Close visualiser"
            className="text-white/40 transition hover:text-white"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* a suspended audio graph is silence — and silence makes a still
          backdrop, which is worth saying out loud rather than leaving the
          listener to wonder why nothing moves */}
      {audioState && audioState !== 'running' && (
        <div className="px-4 py-3 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-amber-300/70">
          THE PLAYER&apos;S AUDIO GRAPH IS {audioState.toUpperCase()} — A SUSPENDED CONTEXT IS SILENCE.
        </div>
      )}

      {/* ---- the live backdrop: VoltViz's own styles, painted across the
           window behind the player from the deck's analyser, one at a
           time. OFF returns the plain backdrop. ---- */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[7px] tracking-[0.2em] text-white/35">LIVE VISUALS</span>
          <span className="font-mono text-[7px] tracking-[0.15em] text-white/25">
            {volt ? name.toUpperCase() : 'OFF'}
          </span>
        </div>
        <div className="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto pr-1">
          <button
            onClick={() => onVolt(null)}
            className={`rounded-lg border px-1 py-1.5 font-mono text-[8px] tracking-[0.1em] transition ${
              volt === null
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                : 'border-white/12 text-white/45 hover:border-white/30 hover:text-white/80'
            }`}
          >
            OFF
          </button>
          {VOLT_STYLES.map((v) => (
            <button
              key={v.id}
              onClick={() => onVolt(v.id)}
              title={v.name}
              className={`truncate rounded-lg border px-1 py-1.5 font-mono text-[8px] tracking-[0.08em] transition ${
                volt === v.id
                  ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                  : 'border-white/12 text-white/45 hover:border-white/30 hover:text-white/80'
              }`}
            >
              {v.name.replace(/ \(WebGPU\)$/, '').toUpperCase()}
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
          VoltViz's styles, painted across the window behind the player from the deck's own
          analyser. One at a time; OFF returns the plain backdrop.
        </p>
      </div>

      {/* ---- the selected visual's own tuning: VoltViz's four settings,
           kept per style, applied live — set apart from the picker above ---- */}
      {volt && (
        <div className="mt-3 border-b border-white/10 px-4 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[7px] tracking-[0.2em] text-white/35">
              SETTINGS · {name.toUpperCase()}
            </span>
            <button
              onClick={() => {
                for (const [key] of tuningFor(volt)) onSetting(key, VOLT_SETTINGS_DEFAULT[key])
              }}
              className="font-mono text-[7px] tracking-[0.15em] text-white/40 transition hover:text-white"
            >
              RESET
            </button>
          </div>
          {tuningFor(volt).map(([key, label]) => {
            const range = VOLT_SETTING_RANGE[key]
            return (
              <div key={key} className="mb-2 last:mb-0">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">
                    {label}
                  </span>
                  <span className="font-mono text-[9px] text-white/40">
                    {shown(key, settings[key])}
                  </span>
                </div>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={settings[key]}
                  onChange={(e) => onSetting(key, Number(e.target.value))}
                  aria-label={`${label.toLowerCase()} for ${name}`}
                  className="chrome-range w-full"
                />
              </div>
            )
          })}
          <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
            VoltViz's own settings, kept for each visual separately — this tuning belongs to{' '}
            {name} alone.
          </p>
        </div>
      )}

      {/* the visual's own settings card, when its module brings one — the
          same Overlay VoltViz itself renders (Halftone Pulse's Mode, Shape,
          Colours and Image), anchored to this panel's corner */}
      {volt && api && OwnCard && <OwnCard api={api} />}
    </div>
  )
}
