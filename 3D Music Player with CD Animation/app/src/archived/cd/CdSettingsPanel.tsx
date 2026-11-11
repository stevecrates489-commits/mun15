/* ============================================================================
 * ARCHIVED — the CD is gone from the player.
 *
 * Nothing outside `src/archived/` imports this file, so it is tree-shaken out
 * of the bundle and never reaches the screen. It is kept so the feature can
 * come back without being rewritten. See ./README.md for the restore steps.
 * ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ImagePlus, Trash2, Disc3, Check } from 'lucide-react'
import { useChromeDrag, type ChromeOffset } from '../../features/layout/useChromeDrag'

/* CD settings card (bottom-left): disc art, spin speed, shortcuts,
   visibility, CD brightness.
   Persistence lives in Home's callbacks — this is presentational.
   `closing` plays the exit animation; onClosed unmounts (panel-out is 160ms). */
export default function CdSettingsPanel({
  cdVisible,
  onCdVisible,
  cdBrightness,
  onCdBrightness,
  shortcuts,
  onShortcuts,
  discArtCustom,
  discArtBusy,
  discArtSource,
  trackArt,
  onTrackArt,
  playlistArt,
  onPlaylistArt,
  discArtNote,
  onDiscArtPick,
  onDiscArtReset,
  collection,
  onApplyArt,
  onDeleteArt,
  onClearArt,
  cdSpeed,
  speeds,
  onCdSpeed,
  onClose,
  closing = false,
  onClosed,
  editing = false,
  offset,
  onOffset,
}: {
  cdVisible: boolean
  onCdVisible: (visible: boolean) => void
  cdBrightness: number
  onCdBrightness: (v: number) => void
  shortcuts: boolean
  onShortcuts: (on: boolean) => void
  discArtCustom: boolean
  discArtBusy: boolean
  /* which layer currently owns the disc face — shown beside the toggles so
     "why is my uploaded label gone" is answerable at a glance */
  discArtSource: 'playlist' | 'track' | 'custom' | 'stock'
  trackArt: boolean
  onTrackArt: (on: boolean) => void
  playlistArt: boolean
  onPlaylistArt: (on: boolean) => void
  /* confirms a just-saved default face, and says when a cover is outranking
     it — the answer to "I uploaded art and the disc did not change" */
  discArtNote?: string | null
  onDiscArtPick: () => void
  onDiscArtReset: () => void
  /* every face ever uploaded — the collection flyout's grid */
  collection: { id: string; url: string }[]
  onApplyArt: (id: string) => void
  onDeleteArt: (id: string) => void
  onClearArt: () => void
  cdSpeed: number
  speeds: number[]
  onCdSpeed: (v: number) => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  /** layout editor — drag this panel while an edit session runs */
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}) {
  const drag = useChromeDrag({ editing, offset, onOffset })
  useEffect(() => {
    if (!closing || !onClosed) return
    const t = window.setTimeout(onClosed, 200)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  /* ---- the collection flyout ----
     Opens on hover of the CD COLLECTION row, rendered through a portal so
     the settings panel's overflow can never clip it. Leaving either the row
     or the flyout starts a short close timer; crossing the gap keeps it up. */
  const [flyout, setFlyout] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef(0)
  const openFlyout = () => {
    window.clearTimeout(closeTimer.current)
    const r = rowRef.current?.getBoundingClientRect()
    if (r) {
      setAnchor({
        top: Math.max(8, Math.min(r.top - 8, window.innerHeight - 360)),
        left: Math.min(r.right + 10, window.innerWidth - 280),
      })
    }
    setFlyout(true)
  }
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setFlyout(false), 260)
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  /* CLEAR ALL is armed by the first press and wiped by the second, so a
     slip of the finger cannot take the whole collection with it */
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])

  /* selective delete — the ids still present in the collection, derived at
     render so a deletion can never leave a ghost in the selection */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const selectedIds = selected.size ? [...selected].filter((id) => collection.some((c) => c.id === id)) : []
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    /* capped to the window and scrollable: the panel is anchored to the
       bottom, so with enough faces in the collection its top would run off
       the screen instead of scrolling */
    <div
      className={`settings-panel panel-resizable fx-blur fixed top-[34%] left-[5%] z-[87] max-h-[calc(100vh-180px)] w-64 overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${closing ? ' is-closing' : ''} ${drag.editClass}`}
      style={drag.style}
      onPointerDownCapture={drag.onPointerDown}
      onClickCapture={drag.onClickCapture}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">CD SETTINGS</span>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">SHORTCUTS</span>
        <button
          aria-label="Toggle keyboard shortcuts"
          onClick={() => onShortcuts(!shortcuts)}
          className={`relative h-4 w-8 rounded-full transition-colors ${shortcuts ? 'bg-emerald-400/80' : 'bg-white/15'}`}
        >
          <span
            className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
            style={{ left: shortcuts ? 18 : 2 }}
          />
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">SHOW DISC</span>
        <button
          aria-label="Toggle CD visibility"
          onClick={() => onCdVisible(!cdVisible)}
          className={`relative h-4 w-8 rounded-full transition-colors ${cdVisible ? 'bg-emerald-400/80' : 'bg-white/15'}`}
        >
          <span
            className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
            style={{ left: cdVisible ? 18 : 2 }}
          />
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">CD BRIGHTNESS</span>
          <span className="font-mono text-[9px] text-white/40">{cdBrightness}%</span>
        </div>
        <input
          type="range"
          min={40}
          max={150}
          value={cdBrightness}
          onChange={(e) => onCdBrightness(Number(e.target.value))}
          className="chrome-range w-full"
        />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">DISC ART</span>
        <span
          data-disc-art-source={discArtSource}
          className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.15em] text-white/35"
        >
          {discArtSource !== 'stock' && (
            <span
              title="The art currently pressed on the disc"
              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300/80"
            />
          )}
          {discArtBusy
            ? 'WORKING…'
            : discArtSource === 'playlist'
              ? 'PLAYLIST'
              : discArtSource === 'track'
                ? 'TRACK'
                : discArtSource === 'custom'
                  ? 'CUSTOM'
                  : 'STOCK'}
        </span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button
          onClick={onDiscArtPick}
          disabled={discArtBusy}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1.5 font-mono text-[8px] tracking-[0.1em] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <ImagePlus size={10} />
          {discArtBusy ? 'WAIT' : discArtCustom ? 'REPLACE' : 'UPLOAD'}
        </button>
        <button
          onClick={onDiscArtReset}
          disabled={!discArtCustom || discArtBusy}
          className="rounded-lg bg-white/5 py-1.5 font-mono text-[8px] tracking-[0.1em] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
        >
          RESET
        </button>
      </div>

      {/* the collection — every face ever uploaded. Hover opens the flyout
          beside the panel (portal: the panel's overflow cannot clip it). */}
      <div
        ref={rowRef}
        onMouseEnter={openFlyout}
        onMouseLeave={scheduleClose}
        className={`mb-2 flex cursor-default items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1.5 transition ${
          flyout ? 'bg-white/10' : 'hover:bg-white/[0.07]'
        }`}
        aria-haspopup="true"
        aria-expanded={flyout}
      >
        <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.15em] text-white/50">
          <Disc3 size={10} />
          CD COLLECTION
        </span>
        <span className="font-mono text-[8px] text-white/30">{collection.length}</span>
      </div>

      {flyout &&
        anchor &&
        createPortal(
          <div
            role="dialog"
            aria-label="CD collection"
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            className="fixed z-[95] max-h-[calc(100vh-20px)] w-64 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-black/85 p-2.5 shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-md"
            style={{ top: anchor.top, left: anchor.left }}
          >
            <div className="mb-2 flex items-center justify-between gap-1.5">
              <button
                onClick={() => {
                  if (!armed) {
                    setArmed(true)
                    return
                  }
                  setArmed(false)
                  setSelected(new Set())
                  onClearArt()
                }}
                onBlur={() => setArmed(false)}
                aria-label={armed ? 'Confirm: clear the whole collection' : 'Clear the whole collection'}
                className={`rounded-lg px-2 py-1 font-mono text-[8px] tracking-[0.12em] transition ${
                  armed
                    ? 'bg-rose-400/90 text-black'
                    : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                }`}
              >
                {armed ? 'SURE?' : 'CLEAR ALL'}
              </button>
              <span className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                {selectedIds.length ? `${selectedIds.length} SELECTED` : `${collection.length} SAVED`}
              </span>
              {selectedIds.length > 0 && (
                <button
                  onClick={() => {
                    for (const id of selectedIds) onDeleteArt(id)
                    setSelected(new Set())
                  }}
                  className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 font-mono text-[8px] tracking-[0.12em] text-rose-300/90 transition hover:bg-rose-400/15 hover:text-rose-200"
                >
                  <Trash2 size={9} />
                  DELETE
                </button>
              )}
            </div>

            {collection.length === 0 ? (
              <div className="px-2 py-6 text-center font-mono text-[8px] leading-relaxed tracking-[0.15em] text-white/30">
                NOTHING SAVED YET
                <br />
                <span className="text-white/20">UPLOAD A FACE — IT LANDS HERE TOO</span>
              </div>
            ) : (
              <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
                {collection.map((item) => {
                  const on = selectedIds.includes(item.id)
                  return (
                    <div key={item.id} className={`group relative overflow-hidden rounded-lg border transition ${on ? 'border-emerald-300/70' : 'border-white/10'}`}>
                      <img
                        src={item.url}
                        alt="Saved disc face"
                        title="Click to wear this face"
                        onClick={() => onApplyArt(item.id)}
                        className="aspect-square w-full cursor-pointer object-cover transition group-hover:scale-[1.04]"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSelect(item.id)
                        }}
                        aria-label={on ? 'Deselect this face' : 'Select this face'}
                        aria-pressed={on}
                        className={`absolute left-1 top-1 grid h-4 w-4 place-items-center rounded border transition ${
                          on ? 'border-emerald-300 bg-emerald-400/90 text-black' : 'border-white/40 bg-black/60 text-transparent opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <Check size={9} strokeWidth={3.5} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteArt(item.id)
                        }}
                        aria-label="Delete this face"
                        title="Delete"
                        className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded border border-white/30 bg-black/60 text-white/70 opacity-0 transition hover:border-rose-300/60 hover:text-rose-300 group-hover:opacity-100"
                      >
                        <Trash2 size={8} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="mt-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
              CLICK A FACE TO WEAR IT · HOVER FOR SELECT AND DELETE
            </p>
          </div>,
          document.body,
        )}

      {/* auto art — the disc can wear the music's own artwork. Both switches
          are on by default and each falls back to the uploaded label, then to
          the stock disc, whenever its cover/poster is missing.
          HIDDEN from the UI for now (kept intact for future use): the options
          remain functional, the panel just no longer shows them. */}
      <div hidden>
        <div className="mb-1.5 font-mono text-[7px] tracking-[0.2em] text-white/25">AUTO DISC ART</div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex flex-col font-mono text-[9px] leading-tight tracking-[0.15em] text-white/50">
            TRACK COVER
            <span className="mt-0.5 text-[7px] tracking-[0.18em] text-white/25">PLAYING TRACK'S COVER</span>
          </span>
          <button
            aria-label="Use the playing track's cover as disc art"
            aria-pressed={trackArt}
            onClick={() => onTrackArt(!trackArt)}
            className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${trackArt ? 'bg-emerald-400/80' : 'bg-white/15'}`}
          >
            <span
              className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
              style={{ left: trackArt ? 18 : 2 }}
            />
          </button>
        </div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex flex-col font-mono text-[9px] leading-tight tracking-[0.15em] text-white/50">
            PLAYLIST COVER
            <span className="mt-0.5 text-[7px] tracking-[0.18em] text-white/25">OPEN PLAYLIST'S POSTER</span>
          </span>
          <button
            aria-label="Use the open playlist's poster as disc art"
            aria-pressed={playlistArt}
            onClick={() => onPlaylistArt(!playlistArt)}
            className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${playlistArt ? 'bg-emerald-400/80' : 'bg-white/15'}`}
          >
            <span
              className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
              style={{ left: playlistArt ? 18 : 2 }}
            />
          </button>
        </div>
      </div>
      {/* the upload is only the DEFAULT face — say so when something outranks
          it, or a successful save reads as a broken button */}
      {discArtNote && (
        <div
          data-disc-art-note
          className="pop-in mb-4 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.07] px-2 py-1 font-mono text-[7px] leading-relaxed tracking-[0.12em] text-emerald-200/80"
        >
          {discArtNote}
          {discArtSource === 'track' || discArtSource === 'playlist'
            ? ' — A COVER IS OVERRIDING IT RIGHT NOW'
            : ' — SHOWING NOW'}
        </div>
      )}
      {!discArtNote && <div className="mb-4" />}

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">DISC SPEED</span>
        <span className="font-mono text-[8px] tracking-[0.15em] text-white/35">
          {cdSpeed === 0 ? 'STOPPED' : `${cdSpeed}x`}
        </span>
      </div>
      <div className="mb-4 grid grid-cols-4 gap-1.5">
        {speeds.map((v) => (
          <button
            key={v}
            onClick={() => onCdSpeed(v)}
            title={v === 0 ? 'No rotation' : v === 1 ? 'Natural BPM cruise' : undefined}
            className={`rounded-lg py-1.5 font-mono text-[8px] tracking-[0.05em] transition ${
              v === cdSpeed ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
            }`}
          >
            {v}x
          </button>
        ))}
      </div>
    </div>
  )
}
