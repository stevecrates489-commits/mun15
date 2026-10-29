import { useEffect } from 'react'
import { X, ImagePlus } from 'lucide-react'

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
  cdSpeed,
  speeds,
  onCdSpeed,
  onClose,
  closing = false,
  onClosed,
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
  cdSpeed: number
  speeds: number[]
  onCdSpeed: (v: number) => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
}) {
  useEffect(() => {
    if (!closing || !onClosed) return
    const t = window.setTimeout(onClosed, 200)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  return (
    <div
      className={`settings-panel fx-blur fixed bottom-[calc(13%+46px)] left-[5%] z-[87] w-64 rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${closing ? ' is-closing' : ''}`}
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

      {/* auto art — the disc can wear the music's own artwork. Both switches
          are on by default and each falls back to the uploaded label, then to
          the stock disc, whenever its cover/poster is missing. */}
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
