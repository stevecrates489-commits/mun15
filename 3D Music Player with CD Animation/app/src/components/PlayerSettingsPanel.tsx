import { X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'

/* Player settings — the home it was moved to when the queue panel's gear
 * pop came out. Crossfade, normalisation and the two "what the interface
 * wears" switches sit beside the transport's own controls (shuffle/repeat
 * stay on the transport itself).
 *
 * The switch block was the drawer's PLAYER SETTINGS section, restyled into
 * this small popup card; every control keeps its aria-pressed contract.
 */
export interface PlayerSettings {
  crossfade: boolean
  crossfadeSec: number
  normalize: boolean
}

function Toggle({
  pressed,
  onToggle,
  label,
}: {
  pressed: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      onClick={onToggle}
      className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
        pressed ? 'bg-emerald-400/80' : 'bg-white/15'
      }`}
    >
      <span
        className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
        style={{ left: pressed ? 18 : 2 }}
      />
    </button>
  )
}

function GlassSwitch() {
  const [on, setOn] = useState(() => localStorage.getItem('md-glass') !== 'off')
  useEffect(() => {
    document.documentElement.dataset.glass = on ? 'on' : 'off'
    localStorage.setItem('md-glass', on ? 'on' : 'off')
  }, [on])
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">GLASS PANELS</span>
        <span className="font-mono text-[8px] text-white/40">{on ? 'BLURRED' : 'SOLID'}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setOn(true)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.15em] transition ${
            on
              ? 'bg-white/90 text-black'
              : 'border border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white'
          }`}
        >
          BLURRED
        </button>
        <button
          onClick={() => setOn(false)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.15em] transition ${
            !on
              ? 'bg-white/90 text-black'
              : 'border border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white'
          }`}
        >
          SOLID · FAST
        </button>
      </div>
    </div>
  )
}

export default function PlayerSettingsPanel({
  settings,
  onSetting,
  accentArt,
  onAccentArt,
  onClose,
  pos,
}: {
  settings: PlayerSettings
  onSetting: (key: 'crossfade' | 'crossfadeSec' | 'normalize', value: number | boolean) => void
  accentArt: boolean
  onAccentArt: (on: boolean) => void
  onClose: () => void
  pos: { x: number; y: number } | null
}) {
  /* any click outside the card dismisses it — the same contract the CD
     settings and colour picker cards keep */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element) {
        if (e.target.closest('[data-player-settings]')) return
        /* the anchor button is also outside the card; let its own click
           handler close it instead of instantly re-opening it */
        if (e.target.closest('[data-player-settings-anchor]')) return
        onClose()
      }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const W = 236
  const style: CSSProperties = pos
    ? {
        left: Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - W - 8)),
        top: Math.min(pos.y, Math.max(8, window.innerHeight - 340)),
      }
    : { left: '5%', top: '20%' }

  return (
    <div
      data-player-settings
      data-liquid-ignore
      className="settings-panel panel-resizable fx-blur fixed z-[88] w-[218px] rounded-2xl border border-white/15 bg-black/85 p-3.5 backdrop-blur-md"
      style={style}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">PLAYER SETTINGS</span>
        <button onClick={onClose} aria-label="Close player settings" className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 py-1">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/75">CROSSFADE</span>
        <Toggle pressed={settings.crossfade} onToggle={() => onSetting('crossfade', !settings.crossfade)} label="Toggle crossfade" />
      </div>
      <div className="mb-1 flex items-center gap-1.5">
        {[0, 3, 5, 8].map((s) => (
          <button
            key={s}
            onClick={() => onSetting('crossfadeSec', s)}
            aria-pressed={settings.crossfadeSec === s}
            title={s === 0 ? 'No crossfade' : `${s}-second blend`}
            className={`flex-1 rounded-md py-1 font-mono text-[8px] tracking-[0.08em] transition ${
              settings.crossfadeSec === s
                ? 'text-black'
                : 'border border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white'
            }`}
            style={
              settings.crossfadeSec === s
                ? {
                    background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 3px 10px rgba(0,0,0,0.5)',
                  }
                : undefined
            }
          >
            {s}s
          </button>
        ))}
      </div>
      <p className="mb-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
        A TRACK'S END BLENDS INTO THE NEXT ONE'S START.
      </p>

      <div className="flex items-center justify-between gap-2 py-1">
        <span className="min-w-0 font-mono text-[9px] leading-tight tracking-[0.15em] text-white/75">
          NORMALIZE VOLUME
        </span>
        <Toggle pressed={settings.normalize} onToggle={() => onSetting('normalize', !settings.normalize)} label="Toggle volume normalisation" />
      </div>
      <p className="mb-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
        {settings.normalize
          ? 'A QUIET TRACK IS LIFTED, A LOUD ONE LEFT — SAME PERCEIVED LOUDNESS.'
          : 'EVEN OUT LOUD AND QUIET TRACKS AUTOMATICALLY.'}
      </p>

      <GlassSwitch />

      <div className="flex items-center justify-between gap-2 py-1">
        <span className="min-w-0 font-mono text-[9px] leading-tight tracking-[0.15em] text-white/75">
          ACCENT FROM ART
        </span>
        <Toggle
          pressed={accentArt}
          onToggle={() => onAccentArt(!accentArt)}
          label="Tint the interface with the playing track's colours"
        />
      </div>
      <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
        {accentArt
          ? 'THE SEEKBAR AND THE PLAYING ROW WEAR THE COVER’S COLOURS.'
          : 'THE INTERFACE STAYS ON THE DECK’S OWN COLOURS.'}
      </p>
    </div>
  )
}
