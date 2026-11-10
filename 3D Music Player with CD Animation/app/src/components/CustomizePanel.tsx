import { useEffect } from 'react'
import { X, Move, RotateCcw, Hand } from 'lucide-react'
import { useChromeDrag, type ChromeOffset } from '../features/layout/useChromeDrag'

interface Props {
  /** whether the CD is currently on the stage — the lyrics editor saves a
      DIFFERENT rectangle for each state, so the panel says which one a save
      will land in */
  cdVisible: boolean
  /** the lyrics' CUSTOM POSITION toggle (moved here from Lyrics Settings) */
  lyricsCustom: boolean
  onLyricsCustom: (on: boolean) => void
  /** a saved queue-panel rectangle exists (enables RESET) */
  queueSaved: boolean
  onResetQueue: () => void
  /** a saved player-panel rectangle exists (enables RESET) */
  musicSaved: boolean
  onResetMusic: () => void
  /** a saved disc rectangle exists (enables RESET) */
  discSaved: boolean
  onResetDisc: () => void
  /** a saved carousel rectangle exists (enables RESET) */
  carouselSaved: boolean
  onResetCarousel: () => void
  /** lyrics must be on for their layout to be editable */
  lyricsEnabled: boolean
  /** edit every floating button and panel, not just the three stage panels */
  /** THE edit mode: chrome controls and all three stage panels at once */
  editChrome: boolean
  onEditChrome: (on: boolean) => void
  /** any button/panel has been moved (enables RESET SCREEN) */
  chromeEdited: boolean
  onResetChrome: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  /** where the button that opened this sits on screen */
  pos?: { x: number; y: number } | null
  /** layout editor — drag this panel while an edit session runs */
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}

/**
 * The central hub for layout editing. One place that says which panels can
 * be moved (lyrics, queue panel, player panel), starts and stops their edit
 * modes, and owns the CUSTOM POSITION toggle that used to live buried in the
 * lyrics settings.
 *
 * Edit mode itself is deliberately NOT persisted: it is a state you enter,
 * rearrange in, and leave through the floating SAVE LAYOUT button — the
 * saved rectangles are what persist.
 */
export default function CustomizePanel({
  cdVisible,
  lyricsCustom,
  onLyricsCustom,
  queueSaved,
  onResetQueue,
  musicSaved,
  onResetMusic,
  discSaved,
  onResetDisc,
  carouselSaved,
  onResetCarousel,
  lyricsEnabled,
  editChrome,
  onEditChrome,
  chromeEdited,
  onResetChrome,
  onClose,
  closing = false,
  onClosed,
  pos = null,
  editing = false,
  offset,
  onOffset,
}: Props) {
  const drag = useChromeDrag({ editing, offset, onOffset })
  useEffect(() => {
    if (!closing || !onClosed) return
    const t = window.setTimeout(onClosed, 200)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  const PANEL_W = 240
  const style: React.CSSProperties = pos
    ? {
        left: Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - PANEL_W - 8)),
        top: Math.min(pos.y, Math.max(8, window.innerHeight - 360)),
      }
    : { left: '5%', top: '13%' }

  return (
    <div
      data-liquid-ignore
      className={`settings-panel panel-resizable fx-blur fixed z-[88] w-60 rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${
        closing ? ' is-closing' : ''
      } ${drag.editClass}`}
      style={{ ...style, ...drag.style }}
      onPointerDownCapture={drag.onPointerDown}
      onClickCapture={drag.onClickCapture}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">CUSTOMIZE</span>
        <button onClick={onClose} aria-label="Close customize panel" className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      {/* ---- lyrics ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">LYRICS</span>
        {lyricsEnabled && <span className="font-mono text-[8px] text-white/30">SAVES: CD {cdVisible ? 'ON' : 'OFF'}</span>}
      </div>
      <div className="mb-1.5 grid grid-cols-1 gap-1.5">
        {/* the moved toggle — with the CD on and off needing different spots,
            editing (not this toggle) is what rearranges: it saves into the
            rectangle belonging to whichever CD state is live */}
        <button
          onClick={() => onLyricsCustom(!lyricsCustom)}
          disabled={!lyricsEnabled || editChrome}
          aria-pressed={lyricsCustom}
          title={
            !lyricsEnabled
              ? 'Turn the lyrics on first'
              : editChrome
                ? 'Editing now — finish with SAVE LAYOUT'
                : lyricsCustom
                  ? 'Back to the standard disc/stage positions'
                  : 'Let the lyrics keep their own saved position'
          }
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-mono text-[8px] tracking-[0.1em] transition disabled:opacity-40 ${
            lyricsCustom ? 'bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Move size={10} />
          CUSTOM POSITION {lyricsCustom ? ': ON' : ''}
        </button>
      </div>

      {/* ---- queue panel (the old tracklist's slot in the editor) ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">QUEUE</span>
        <span className="font-mono text-[8px] text-white/30">{queueSaved ? 'SAVED' : 'DOCKED'}</span>
      </div>
      <div className="mb-3 flex items-center justify-between gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5">
        <span className="font-mono text-[7px] leading-relaxed tracking-[0.12em] text-white/30">
          DRAG + RESIZE IN EDIT MODE
        </span>
        <button
          onClick={onResetQueue}
          disabled={!queueSaved}
          title="Drop the saved queue panel position and dock it back"
          aria-label="Reset queue panel layout"
          className="grid w-9 place-items-center rounded-lg bg-white/5 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={10} />
        </button>
      </div>

      {/* ---- player ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">PLAYER</span>
        <span className="font-mono text-[8px] text-white/30">{musicSaved ? 'SAVED' : 'DOCKED'}</span>
      </div>
      <div className="mb-3 flex items-center justify-between gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5">
        <span className="font-mono text-[7px] leading-relaxed tracking-[0.12em] text-white/30">
          DRAG + RESIZE IN EDIT MODE
        </span>
        <button
          onClick={onResetMusic}
          disabled={!musicSaved}
          title="Drop the saved player position and dock it back"
          aria-label="Reset player layout"
          className="grid w-9 place-items-center rounded-lg bg-white/5 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={10} />
        </button>
      </div>

      {/* ---- disc (and the on-disc lyrics that travel with it) ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">CD</span>
        <span className="font-mono text-[8px] text-white/30">{discSaved ? 'SAVED' : 'IN STAGE'}</span>
      </div>
      <div className="mb-3 flex items-center justify-between gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5">
        <span className="font-mono text-[7px] leading-relaxed tracking-[0.12em] text-white/30">
          MOVE THE CD — LYRICS FOLLOW
        </span>
        <button
          onClick={onResetDisc}
          disabled={!discSaved}
          title="Drop the saved CD position and dock it back into the stage"
          aria-label="Reset CD layout"
          className="grid w-9 place-items-center rounded-lg bg-white/5 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={10} />
        </button>
      </div>

      {/* ---- carousel ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">SONGS</span>
        <span className="font-mono text-[8px] text-white/30">{carouselSaved ? 'SAVED' : 'DOCKED'}</span>
      </div>
      <div className="mb-3 flex items-center justify-between gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5">
        <span className="font-mono text-[7px] leading-relaxed tracking-[0.12em] text-white/30">
          CYLINDER ABOVE PLAYER
        </span>
        <button
          onClick={onResetCarousel}
          disabled={!carouselSaved}
          title="Drop the saved carousel position and dock it above the player"
          aria-label="Reset carousel layout"
          className="grid w-9 place-items-center rounded-lg bg-white/5 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={10} />
        </button>
      </div>

      {/* ---- screen ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">SCREEN</span>
        {chromeEdited && <span className="font-mono text-[8px] text-white/30">MOVED</span>}
      </div>
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-1.5">
        <button
          onClick={() => onEditChrome(!editChrome)}
          aria-pressed={editChrome}
          title="Move every button, header control and panel — the three stage panels get resize handles too"
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-mono text-[8px] tracking-[0.1em] transition ${
            editChrome ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Hand size={10} />
          {editChrome ? 'EDITING LAYOUT…' : 'EDIT LAYOUT'}
        </button>
        <button
          onClick={onResetChrome}
          disabled={!chromeEdited}
          title="Put every button and panel back where it started"
          aria-label="Reset screen layout"
          className="grid w-9 place-items-center rounded-lg bg-white/5 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={10} />
        </button>
      </div>

      <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
        EDIT LAYOUT starts the one edit session · every button, header control and panel moves on its own · dots
        resize the three stage panels · movement is free (nothing is clamped) · the floating SAVE LAYOUT button
        finishes · RESET puts the chrome back · lyrics keep one layout per CD state
      </p>
    </div>
  )
}
