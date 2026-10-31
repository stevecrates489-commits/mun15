import { useEffect } from 'react'
import { X, Move, Check, RotateCcw } from 'lucide-react'

interface Props {
  /** whether the CD is currently on the stage — the lyrics editor saves a
      DIFFERENT rectangle for each state, so the panel says which one a save
      will land in */
  cdVisible: boolean
  /** the lyrics' CUSTOM POSITION toggle (moved here from Lyrics Settings) */
  lyricsCustom: boolean
  onLyricsCustom: (on: boolean) => void
  /** edit modes — transient, finished by the floating SAVE LAYOUT button */
  editLyrics: boolean
  onEditLyrics: (on: boolean) => void
  editTracklist: boolean
  onEditTracklist: (on: boolean) => void
  /** a saved tracklist rectangle exists (enables RESET) */
  tracklistSaved: boolean
  onResetTracklist: () => void
  /** lyrics must be on for their layout to be editable */
  lyricsEnabled: boolean
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  /** where the button that opened this sits on screen */
  pos?: { x: number; y: number } | null
}

/**
 * The central hub for layout editing. One place that says which panels can
 * be moved (lyrics, tracklist), starts and stops their edit modes, and owns
 * the CUSTOM POSITION toggle that used to live buried in the lyrics settings.
 *
 * Edit mode itself is deliberately NOT persisted: it is a state you enter,
 * rearrange in, and leave through the floating SAVE LAYOUT button — the
 * saved rectangles are what persist.
 */
export default function CustomizePanel({
  cdVisible,
  lyricsCustom,
  onLyricsCustom,
  editLyrics,
  onEditLyrics,
  editTracklist,
  onEditTracklist,
  tracklistSaved,
  onResetTracklist,
  lyricsEnabled,
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

  const PANEL_W = 240
  const style: React.CSSProperties = pos
    ? {
        left: Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - PANEL_W - 8)),
        top: Math.min(pos.y, Math.max(8, window.innerHeight - 360)),
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
          disabled={!lyricsEnabled || editLyrics}
          aria-pressed={lyricsCustom}
          title={
            !lyricsEnabled
              ? 'Turn the lyrics on first'
              : editLyrics
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
        <button
          onClick={() => onEditLyrics(!editLyrics)}
          disabled={!lyricsEnabled}
          aria-pressed={editLyrics}
          title={!lyricsEnabled ? 'Turn the lyrics on first' : 'Drag and resize the lyrics, then save'}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-mono text-[8px] tracking-[0.1em] transition disabled:opacity-40 ${
            editLyrics ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Check size={10} />
          {editLyrics ? 'EDITING LYRICS…' : 'EDIT LYRICS LAYOUT'}
        </button>
      </div>

      {/* ---- tracklist ---- */}
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">TRACKLIST</span>
        {tracklistSaved && <span className="font-mono text-[8px] text-white/30">SAVED</span>}
      </div>
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-1.5">
        <button
          onClick={() => onEditTracklist(!editTracklist)}
          aria-pressed={editTracklist}
          title="Drag and resize the tracklist, then save"
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-mono text-[8px] tracking-[0.1em] transition ${
            editTracklist ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Check size={10} />
          {editTracklist ? 'EDITING…' : 'EDIT TRACKLIST LAYOUT'}
        </button>
        <button
          onClick={onResetTracklist}
          disabled={!tracklistSaved}
          title="Drop the saved tracklist position and dock it back"
          aria-label="Reset tracklist layout"
          className="grid w-9 place-items-center rounded-lg bg-white/5 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={10} />
        </button>
      </div>

      <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
        EDIT starts an edit session · drag the panel to move · dots resize · the floating SAVE LAYOUT button finishes ·
        lyrics keep one layout per CD state
      </p>
    </div>
  )
}
