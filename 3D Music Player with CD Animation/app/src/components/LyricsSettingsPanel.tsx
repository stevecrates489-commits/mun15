import { useEffect, useState } from 'react'
import { X, Download, Pin, PinOff, Pencil, Clock } from 'lucide-react'
import type { LyricsApi } from './LyricsPanel'
import { LYRIC_SIZES, SIZE_LABELS } from '../features/lyrics/useLyrics'
import { useChromeDrag, type ChromeOffset } from '../features/layout/useChromeDrag'
import ProviderList from '../features/lyrics/ProviderList'
import { useProviderOrder } from '../features/lyrics/useProviderOrder'
import { providerById } from '../features/lyrics/registry'

interface Props {
  api: LyricsApi | null
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
  /** layout editor — drag this panel while an edit session runs. Named
      apart from the lyric `offset` controls above, which are numbers. */
  chromeEditing?: boolean
  layoutOffset?: ChromeOffset
  onLayoutOffset?: (o: ChromeOffset) => void
}

/**
 * Home for everything `<am-lyrics>` would otherwise render itself, plus the
 * controls that only exist because the lyrics sit on hardware: how bright
 * they are, and how far out of step the provider's timestamps are. The
 * on/beside-disc position buttons are gone — the lyrics are freely movable
 * in the layout editor, so a fixed position choice has nothing to choose.
 */
export default function LyricsSettingsPanel({
  api,
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
  chromeEditing = false,
  layoutOffset,
  onLayoutOffset,
}: Props) {
  const drag = useChromeDrag({ editing: chromeEditing, offset: layoutOffset, onOffset: onLayoutOffset })
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

  /* ---- the providers ----
     The chain: who is asked, in what order. The order is the person's to
     set, it is kept between sessions, and the reset puts it back the way
     the waterfall has it. */
  const { order, setOrder } = useProviderOrder()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [forcingId, setForcingId] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)

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
      setActiveId(api?.providerId() ?? null)
    }
    read()
    const iv = window.setInterval(read, 1500)
    return () => window.clearInterval(iv)
  }, [api, closing])

  /**
   * Ask ONE provider for this track and put its answer on screen.
   *
   * A provider that has nothing leaves the words on screen alone: the
   * failure is reported in the panel and the lyrics are not touched.
   */
  const force = async (id: string) => {
    if (!api || forcingId) return
    setForcingId(id)
    setProviderError(null)
    try {
      const answer = await api.forceProvider(id)
      if (!answer.ok) {
        const name = providerById(id)?.short ?? id
        setProviderError(`${name} — ${answer.error ?? 'NOTHING FOUND'}`)
        return
      }
      setActiveId(id)
      setSource(api.source())
      setHasLyrics(!!api.hasLyrics())
    } catch {
      setProviderError('THE PROVIDER COULD NOT BE REACHED')
    } finally {
      setForcingId(null)
    }
  }

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
     it keeps the old card position so it is never lost off-screen.

     The provider list made this panel much taller than it was, so the height
     is not measured but bounded: the panel is given the room it has below its
     own top edge and scrolls what does not fit. Measuring it instead would
     mean a resize observer feeding a re-render on every frame of the opening
     animation — and a panel that is re-rendered while it animates never
     finishes animating. */
  const PANEL_W = 240
  const top = pos ? Math.min(pos.y, Math.max(8, window.innerHeight - 420)) : 0
  const style: React.CSSProperties = pos
    ? {
        left: Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - PANEL_W - 8)),
        top,
        maxHeight: `calc(100vh - ${top}px - 8px)`,
      }
    : { left: '5%', top: '13%' }

  return (
    <div
      className={`settings-panel panel-resizable thin-scroll fx-blur fixed z-[88] w-60 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/15 bg-black/85 p-3.5 backdrop-blur-md${
        closing ? ' is-closing' : ''
      } ${drag.editClass}`}
      style={{ ...style, ...drag.style }}
      onPointerDownCapture={drag.onPointerDown}
      onClickCapture={drag.onClickCapture}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">LYRICS SETTINGS</span>
        <button onClick={onClose} aria-label="Close lyrics settings" className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      {/* the on-disc / beside-disc buttons are gone: the lyrics panel is
          freely movable in the layout editor, so a fixed position choice
          would only fight the saved rectangle */}

      {/* custom position lives in the CUSTOMIZE panel now — it is a hub for
          every movable panel (lyrics AND tracklist), not a lyrics-only
          setting, so it moved out of here rather than growing a sibling */}

      {/* ---- local copy ---- */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">THIS TRACK</span>
        <span className="font-mono text-[8px] text-white/30">{pinned ? 'ON DISK' : 'FETCHED'}</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
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

      {/* ---- source and the chain ----
          The SOURCE row says where the words on screen came from. The list
          below is the chain itself: every provider, which tier it belongs
          to, and the order they are asked in — the first one is asked
          first. Clicking a provider asks that one and puts its answer on
          screen; a provider that has nothing leaves the words alone and
          says so here. */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">SOURCE</span>
        <span className="max-w-[110px] truncate font-mono text-[8px] text-white/45">{source ?? '…'}</span>
      </div>
      <ProviderList
        order={order}
        activeId={activeId}
        onReorder={setOrder}
        onForce={force}
        busyId={forcingId}
        error={providerError}
      />

      {/* ---- size ---- */}
      <div className="mb-2.5">
        <div className="mb-1.5 flex items-center justify-between">
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
      <div className="mb-2.5">
        <div className="mb-1.5 flex items-center justify-between">
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
      <div className="mb-2.5">
        <div className="mb-1.5 flex items-center justify-between">
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
        disabled={!api || busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1.5 font-mono text-[8px] tracking-[0.1em] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <Download size={10} />
        DOWNLOAD LYRICS
      </button>
    </div>
  )
}
