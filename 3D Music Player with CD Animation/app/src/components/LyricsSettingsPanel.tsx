import { useEffect, useState } from 'react'
import { X, RefreshCw, Download, Pin, PinOff, Pencil, Clock, AlignLeft, AlignRight } from 'lucide-react'
import type { LyricsApi } from './LyricsPanel'
import { LYRIC_SIZES, SIZE_LABELS, type LyricsAlign, type LyricsMode } from '../features/lyrics/useLyrics'

interface Props {
  api: LyricsApi | null
  mode: LyricsMode
  onMode: (align: LyricsAlign) => void
  size: number
  onSize: (v: number) => void
  brightness: number
  onBrightness: (v: number) => void
  offset: number
  onOffset: (v: number) => void
  /** true when this track already has lyrics stored on disk */
  pinned: boolean
  onPin: () => void
  onUnpin: () => void
  onEdit: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  /** where the gear button that opened this sits on screen */
  pos?: { x: number; y: number } | null
}

/**
 * Home for everything `<am-lyrics>` would otherwise render itself, plus the
 * controls that only exist because the lyrics sit on hardware: which of the
 * three positions they occupy, how bright they are, and how far out of step
 * the provider's timestamps are.
 */
export default function LyricsSettingsPanel({
  api,
  mode,
  onMode,
  size,
  onSize,
  brightness,
  onBrightness,
  offset,
  onOffset,
  pinned,
  onPin,
  onUnpin,
  onEdit,
  onClose,
  closing = false,
  onClosed,
  pos = null,
}: Props) {
  useEffect(() => {
    if (!closing || !onClosed) return
    const t = window.setTimeout(onClosed, 200)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  /* the provider label and the loaded state live inside the component's shadow
     DOM, so they can only be polled — re-read while the panel is open */
  const [source, setSource] = useState<string | null>(null)
  const [hasLyrics, setHasLyrics] = useState(false)
  const [busy, setBusy] = useState(false)
  /* the offset readout flips to a text field when clicked — see the block below */
  const [editing, setEditing] = useState(false)

  /* accept anything a person would type: "3.2", "+1.5", "-4", "2s", "" (reset) */
  const commit = (raw: string) => {
    setEditing(false)
    const n = Number.parseFloat(raw.replace(/[^0-9.+-]/g, ''))
    onOffset(Number.isFinite(n) ? n : 0)
  }
  useEffect(() => {
    if (closing) return
    const read = () => {
      setSource(api?.source() ?? null)
      setHasLyrics(!!api?.hasLyrics())
    }
    read()
    const iv = window.setInterval(read, 1500)
    return () => window.clearInterval(iv)
  }, [api, closing])

  const act = (fn: (() => boolean) | undefined, settle = 600) => {
    if (!fn) return
    setBusy(true)
    try {
      fn()
    } finally {
      /* the component's own switch is animated; release the flag a beat later
         so the button can't be double-fired into a stacked fetch */
      window.setTimeout(() => setBusy(false), settle)
      window.setTimeout(() => setSource(api?.source() ?? null), settle + 300)
    }
  }

  /* opens under the gear that opened it — clamped so a right-side button
     never pushes the 240px panel off the edge of the window. Only when the
     button's rect actually reached us (pos) does the panel anchor; otherwise
     it keeps the old card position so it is never lost off-screen. */
  const PANEL_W = 240
  const style: React.CSSProperties = pos
    ? {
        left: Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - PANEL_W - 8)),
        top: Math.min(pos.y, Math.max(8, window.innerHeight - 320)),
      }
    : { left: '5%', top: '13%' }

  return (
    <div
      className={`settings-panel fx-blur fixed z-[88] w-60 rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${
        closing ? ' is-closing' : ''
      }`}
      style={style}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">LYRICS SETTINGS</span>
        <button onClick={onClose} aria-label="Close lyrics settings" className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      {/* ---- position ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">POSITION</span>
        {mode === 'stage' && <span className="font-mono text-[8px] text-white/30">CD HIDDEN</span>}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-1.5">
        {(
          [
            ['disc-left', 'ON DISC', AlignLeft],
            ['disc-right', 'BESIDE DISC', AlignRight],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => onMode(value)}
            disabled={mode === 'stage'}
            title={mode === 'stage' ? 'Turn the CD back on to place the lyrics beside it' : undefined}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-mono text-[8px] tracking-[0.05em] transition ${
              mode === value ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
            } ${mode === 'stage' ? 'opacity-40' : ''}`}
          >
            <Icon size={10} />
            {label}
          </button>
        ))}
      </div>

      {/* ---- local copy ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">THIS TRACK</span>
        <span className="font-mono text-[8px] text-white/30">{pinned ? 'ON DISK' : 'FETCHED'}</span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-1.5">
        <button
          onClick={pinned ? onUnpin : onPin}
          disabled={!pinned && !hasLyrics}
          title={
            pinned
              ? 'Delete the stored copy and fetch again'
              : hasLyrics
                ? 'Store these lyrics so they never re-fetch'
                : 'Nothing loaded to store yet'
          }
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-mono text-[8px] tracking-[0.05em] transition disabled:opacity-30 ${
            pinned
              ? 'bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25'
              : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          {pinned ? <PinOff size={10} /> : <Pin size={10} />}
          {pinned ? 'UNPIN' : 'PIN'}
        </button>
        <button
          onClick={onEdit}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1.5 font-mono text-[8px] tracking-[0.05em] text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <Pencil size={10} />
          EDIT
        </button>
      </div>

      {/* ---- source ---- */}
      {!pinned && (
        <>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">SOURCE</span>
            <span className="max-w-[110px] truncate font-mono text-[8px] text-white/45">{source ?? '…'}</span>
          </div>
          <button
            onClick={() => act(api?.switchSource)}
            disabled={busy || !api}
            className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1.5 font-mono text-[8px] tracking-[0.1em] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={10} className={busy ? 'animate-spin' : undefined} />
            {busy ? 'SWITCHING…' : 'SWITCH PROVIDER'}
          </button>
        </>
      )}

      {/* ---- size ---- */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">TEXT SIZE</span>
          <span className="font-mono text-[8px] text-white/40">{size}px</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {LYRIC_SIZES.map((v, i) => (
            <button
              key={v}
              onClick={() => onSize(v)}
              className={`rounded-lg py-1.5 font-mono text-[8px] tracking-[0.05em] transition ${
                v === size ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
              }`}
            >
              {SIZE_LABELS[i]}
            </button>
          ))}
        </div>
      </div>

      {/* ---- brightness ---- */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">BRIGHTNESS</span>
          <span className="font-mono text-[8px] text-white/40">{brightness}%</span>
        </div>
        <input
          type="range"
          min={20}
          max={160}
          value={brightness}
          onChange={(e) => onBrightness(Number(e.target.value))}
          className="chrome-range w-full"
        />
      </div>

      {/* ---- sync offset ----
          Clicking the number turns it into a typed field: ±0.5s jumps get you
          into the right neighbourhood fast, but a rip that is 3.2s out needs an
          exact value, and 6 clicks per second of correction is no way to live.
          No clamp — a provider can be wildly off and there is nothing wrong
          with correcting by a minute. */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">SYNC OFFSET</span>
          <span className="font-mono text-[8px] text-white/40">THIS TRACK</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={11} className="shrink-0 text-white/35" />
          <button
            onClick={() => onOffset(offset - 0.5)}
            aria-label="Lyrics earlier"
            className="flex-1 rounded-lg bg-white/5 py-1 font-mono text-[10px] text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            −
          </button>
          {editing ? (
            <input
              autoFocus
              defaultValue={offset.toFixed(1)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(e.currentTarget.value)
                if (e.key === 'Escape') setEditing(false)
              }}
              aria-label="Sync offset in seconds"
              className="w-12 rounded bg-white/10 px-1 py-0.5 text-center font-mono text-[9px] text-white outline-none"
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              title="Type an exact value"
              className="w-12 text-center font-mono text-[9px] text-white/60 transition hover:text-white"
            >
              {offset > 0 ? '+' : ''}
              {offset.toFixed(1)}s
            </button>
          )}
          <button
            onClick={() => onOffset(offset + 0.5)}
            aria-label="Lyrics later"
            className="flex-1 rounded-lg bg-white/5 py-1 font-mono text-[10px] text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            +
          </button>
        </div>
        <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
          − moves the words earlier · + moves them later · click the value to type
        </p>
      </div>

      <button
        onClick={() => act(api?.download)}
        disabled={!api}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1.5 font-mono text-[8px] tracking-[0.1em] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <Download size={10} />
        DOWNLOAD LYRICS
      </button>
    </div>
  )
}
