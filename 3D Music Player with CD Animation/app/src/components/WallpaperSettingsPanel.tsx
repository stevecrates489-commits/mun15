import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Images, Trash2 } from 'lucide-react'
import { MAX_SECONDS as WALL_MAX_SECONDS, FPS_MIN, FPS_MAX, type WallPreset, type WallpaperRecord } from '../lib/wallpaperPipeline'

/* Wallpaper settings card (bottom-right): pick quality → pick fps → press
   CONVERT (selection is inert; the hook only converts on onConvert), speed,
   blur, dim, pause-when-hidden, saved-wallpaper library, cache clear.
   `closing` plays the exit animation; onClosed unmounts (panel-out is 160ms). */
/* ONE object URL per vault record. Calling createObjectURL inside the JSX
   minted a fresh URL (pinning the poster/video blob in memory) on every
   re-render: dragging a slider over a vault of videos leaked hundreds of blob
   URLs into the session.

   The cache is MODULE-level on purpose. Both earlier shapes were wrong:
   memo + a cleanup effect let StrictMode's mount→unmount→remount cycle revoke
   every URL and hand the remount the same strings back (blank thumbnails, while
   clicking a record still worked because that path builds its own URL from the
   blob), and putting the mint in an effect is rejected by the react-hooks
   compiler. A module is never re-evaluated, so its entries survive the
   StrictMode cycle and are reused rather than resurrected. */
const thumbCache = new Map<string, { blob: Blob; url: string }>()

function thumbUrlFor(rec: WallpaperRecord): string {
  const wants = rec.poster || rec.blob.type.startsWith('image/')
  if (!wants) return ''
  const blob = rec.poster ?? rec.blob
  const hit = thumbCache.get(rec.id)
  if (hit) {
    /* the same record re-imported under the same id is a different blob */
    if (hit.blob === blob) return hit.url
    URL.revokeObjectURL(hit.url)
  }
  const url = URL.createObjectURL(blob)
  thumbCache.set(rec.id, { blob, url })
  return url
}

/* a record removed from the vault is gone for good, so its URL finally goes */
function pruneThumbCache(live: Set<string>): void {
  for (const [id, hit] of thumbCache) {
    if (live.has(id)) continue
    URL.revokeObjectURL(hit.url)
    thumbCache.delete(id)
  }
}

export default function WallpaperSettingsPanel({
  pendingWallFile,
  wallQuality,
  onPickQuality,
  wallFpsTarget,
  onFpsTarget,
  wallStart,
  onStart,
  wallSpeed,
  onSpeed,
  wallBlur,
  onBlurToggle,
  wallDim,
  onDim,
  wallPauseHidden,
  onPauseHiddenToggle,
  videoPresent,
  canConvert,
  converting,
  onConvert,
  onClearCache,
  savedWallpapers,
  onSwitchWallpaper,
  onRemoveSaved,
  onAddNew,
  onClose,
  closing = false,
  onClosed,
}: {
  pendingWallFile: File | null
  wallQuality: WallPreset
  onPickQuality: (q: WallPreset) => void
  wallFpsTarget: number | null
  onFpsTarget: (n: number | null) => void
  wallStart: number
  onStart: (n: number) => void
  wallSpeed: number
  onSpeed: (s: number) => void
  wallBlur: boolean
  onBlurToggle: (v: boolean) => void
  wallDim: number
  onDim: (v: number) => void
  wallPauseHidden: boolean
  onPauseHiddenToggle: (v: boolean) => void
  videoPresent: boolean
  canConvert: boolean
  converting: boolean
  onConvert: () => void
  onClearCache: () => void
  savedWallpapers: WallpaperRecord[]
  onSwitchWallpaper: (rec: WallpaperRecord) => void
  onRemoveSaved: (id: string) => void
  onAddNew: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
}) {
  useEffect(() => {
    if (!closing || !onClosed) return
    const t = window.setTimeout(onClosed, 200)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  /* ---- the "Your Wallpapers" flyout ----
     Same mechanism as the CD Collection's: opens on hover of the row,
     rendered through a portal so the panel's overflow can never clip it.
     It opens to the LEFT — the panel sits against the right edge of the
     window, so there is no room on its right. Leaving either the row or
     the flyout starts a short close timer; crossing the gap keeps it up. */
  const [flyout, setFlyout] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef(0)
  const FLYOUT_W = 288
  const openFlyout = () => {
    window.clearTimeout(closeTimer.current)
    const r = rowRef.current?.getBoundingClientRect()
    if (r) {
      setAnchor({
        top: Math.max(8, Math.min(r.top - 8, window.innerHeight - 420)),
        left: Math.max(8, r.left - 10 - FLYOUT_W),
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
     slip of the finger cannot take the whole vault with it */
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])

  /* release anything the vault has dropped, then hand back a live URL per
     record — stable across renders and across a StrictMode remount */
  pruneThumbCache(new Set(savedWallpapers.map((r) => r.id)))
  const thumbUrls = new Map(savedWallpapers.map((rec): [string, string] => [rec.id, thumbUrlFor(rec)]))

  return (
    <div
      className={`settings-panel fx-blur fixed bottom-[calc(13%+46px)] right-[5%] z-[87] max-h-[calc(100vh-180px)] w-72 overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${closing ? ' is-closing' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">WALLPAPER SETTINGS</span>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      {pendingWallFile && (
        <div className="mb-3 rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-2.5 py-2 font-mono text-[8px] leading-relaxed tracking-[0.12em] text-cyan-300/80">
          NEW VIDEO QUEUED — PICK A QUALITY + FPS, THEN PRESS CONVERT
        </div>
      )}

      <div className="mb-1 font-mono text-[8px] tracking-[0.2em] text-white/35">QUALITY / PERFORMANCE</div>
      <div className="mb-1 grid grid-cols-4 gap-1.5">
        {(['high', 'balanced', 'performance', 'original'] as const).map((q) => (
          <button
            key={q}
            onClick={() => onPickQuality(q)}
            className={`rounded-lg px-1 py-1.5 font-mono text-[8px] leading-tight tracking-[0.08em] transition ${
              wallQuality === q ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
            }`}
          >
            {q === 'high' ? 'HIGH' : q === 'balanced' ? 'BALANCED' : q === 'performance' ? 'PERF' : 'ORIGINAL'}
            <br />
            <span className="opacity-60">{q === 'high' ? '1080p' : q === 'balanced' ? '720p' : q === 'performance' ? '480p' : 'RAW'}</span>
          </button>
        ))}
      </div>
      {wallQuality !== 'original' && (
        <>
          <div className="mt-2 mb-1 flex items-center justify-between">
            <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">TARGET FPS</span>
            <span className="font-mono text-[8px] text-white/40">
              {wallFpsTarget ?? `AUTO (${wallQuality === 'high' ? '30' : wallQuality === 'balanced' ? '30' : '24'})`}
            </span>
          </div>
          <input
            type="range"
            min={FPS_MIN}
            max={FPS_MAX}
            value={wallFpsTarget ?? FPS_MIN}
            onChange={(e) => onFpsTarget(Number(e.target.value))}
            className="chrome-range mb-1 w-full"
          />
          <button
            onClick={() => onFpsTarget(null)}
            className="mb-3 font-mono text-[8px] tracking-[0.15em] text-white/35 hover:text-white"
          >
            RESET TO AUTO
          </button>
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">START AT (SECONDS)</span>
              <span className="font-mono text-[8px] text-white/40">{wallStart}s</span>
            </div>
            <input
              type="number"
              min={0}
              max={WALL_MAX_SECONDS - 1}
              value={wallStart}
              onChange={(e) => onStart(Math.min(WALL_MAX_SECONDS - 1, Math.max(0, Number(e.target.value) || 0)))}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] text-white/80 outline-none focus:border-white/40"
            />
          </div>
        </>
      )}
      {wallQuality === 'original' && (
        <div className="mb-3 rounded-lg border border-amber-300/25 bg-amber-300/5 px-2.5 py-2 font-mono text-[8px] leading-relaxed tracking-[0.1em] text-amber-300/80">
          ORIGINAL MODE — the file is stored and played as-is. Smooth only if your source already is.
        </div>
      )}

      {/* CONVERT — fixed space so the panel never jumps between states */}
      <div className="mb-4 flex min-h-[34px] items-stretch">
        {canConvert ? (
          <button
            onClick={onConvert}
            disabled={converting}
            className="w-full rounded-lg bg-gradient-to-br from-white/90 to-white/60 px-3 py-2 font-mono text-[9px] tracking-[0.25em] text-black transition hover:from-white hover:to-white/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {converting ? 'CONVERTING…' : '⟳ CONVERT'}
          </button>
        ) : (
          <div className="flex w-full items-center justify-center rounded-lg border border-dashed border-white/15 px-3 font-mono text-[8px] tracking-[0.15em] text-white/30">
            IMPORT A VIDEO TO CONVERT
          </div>
        )}
      </div>

      <div className="mb-1 font-mono text-[8px] tracking-[0.2em] text-white/35">PLAYBACK SPEED</div>
      <div className="mb-4 grid grid-cols-2 gap-1.5">
        {([1, 0.75] as const).map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.1em] transition ${
              wallSpeed === s ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
            }`}
          >
            {s === 1 ? 'NORMAL 1.0×' : 'SLOW 0.75×'}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">BLUR BACKGROUND</span>
        <button
          aria-label="Toggle wallpaper blur"
          onClick={() => onBlurToggle(!wallBlur)}
          className={`relative h-4 w-8 rounded-full transition-colors ${wallBlur ? 'bg-emerald-400/80' : 'bg-white/15'}`}
        >
          <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style={{ left: wallBlur ? 18 : 2 }} />
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">DIM</span>
          <span className="font-mono text-[9px] text-white/40">{wallDim}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={80}
          value={wallDim}
          onChange={(e) => onDim(Number(e.target.value))}
          className="chrome-range w-full"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">PAUSE WHEN HIDDEN</span>
        <button
          aria-label="Toggle pause when hidden"
          onClick={() => onPauseHiddenToggle(!wallPauseHidden)}
          className={`relative h-4 w-8 rounded-full transition-colors ${wallPauseHidden ? 'bg-emerald-400/80' : 'bg-white/15'}`}
        >
          <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style={{ left: wallPauseHidden ? 18 : 2 }} />
        </button>
      </div>

      {/* your wallpapers — a hover flyout (to the LEFT, portal-rendered)
          instead of an in-panel list: a vault of videos used to stretch the
          panel until its close button ran off the window. The panel keeps
          only the row and the ADD button. */}
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
          <Images size={10} />
          YOUR WALLPAPERS
        </span>
        <span className="font-mono text-[8px] text-white/30">{savedWallpapers.length}</span>
      </div>

      {flyout &&
        anchor &&
        createPortal(
          <div
            role="dialog"
            aria-label="Saved wallpapers"
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            className="fixed z-[95] max-h-[calc(100vh-20px)] w-72 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-black/80 p-2.5 shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-md"
            style={{ top: anchor.top, left: anchor.left }}
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => {
                  if (!armed) {
                    setArmed(true)
                    return
                  }
                  setArmed(false)
                  for (const rec of savedWallpapers) onRemoveSaved(rec.id)
                }}
                onBlur={() => setArmed(false)}
                disabled={savedWallpapers.length === 0}
                aria-label={armed ? 'Confirm: remove every saved wallpaper' : 'Remove every saved wallpaper'}
                className={`rounded-lg px-2 py-1 font-mono text-[8px] tracking-[0.12em] transition disabled:opacity-30 ${
                  armed
                    ? 'bg-rose-400/90 text-black'
                    : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                }`}
              >
                {armed ? 'SURE?' : 'CLEAR ALL'}
              </button>
              <span className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                {savedWallpapers.length} SAVED
              </span>
            </div>

            {savedWallpapers.length === 0 ? (
              <div className="px-2 py-6 text-center font-mono text-[8px] leading-relaxed tracking-[0.15em] text-white/30">
                NOTHING SAVED YET
                <br />
                <span className="text-white/20">CONVERT OR IMPORT A WALLPAPER — IT LANDS HERE</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {savedWallpapers.map((rec) => (
                  <div
                    key={rec.id}
                    className="group flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 transition-colors hover:bg-white/[0.07]"
                    onClick={() => onSwitchWallpaper(rec)}
                  >
                    {rec.poster || rec.blob.type.startsWith('image/') ? (
                      <img
                        src={thumbUrls.get(rec.id) ?? ''}
                        alt=""
                        draggable={false}
                        className="h-8 w-14 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="h-8 w-14 shrink-0 rounded bg-white/5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-white/70 group-hover:text-white">
                        {rec.name || 'Untitled'}
                      </span>
                      <span className="block font-mono text-[8px] text-white/30">
                        {rec.blob.type.startsWith('image/')
                          ? `image · ${(rec.size / 1e6).toFixed(1)}MB`
                          : `${rec.width}×${rec.height} · ${rec.fps}fps · ${(rec.size / 1e6).toFixed(1)}MB`}
                        {!rec.converted && !rec.blob.type.startsWith('image/') && ' · original'}
                        {rec.hdr && ' · HDR'}
                      </span>
                    </span>
                    <button
                      aria-label={`Delete ${rec.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveSaved(rec.id)
                      }}
                      className="shrink-0 text-white/25 transition-colors hover:text-red-400"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 flex items-center gap-1 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
              <Trash2 size={8} />
              CLICK A WALLPAPER TO WEAR IT · X DELETES IT
            </p>
          </div>,
          document.body,
        )}

      {/* ADD — full-width outline button, same visual language as the panel's
          other controls; the old corner pill next to the label was cramped */}
      <button
        onClick={onAddNew}
        className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/25 px-3 py-1.5 font-mono text-[8px] tracking-[0.2em] text-white/55 transition hover:border-white/45 hover:text-white"
      >
        <Plus size={10} />
        ADD WALLPAPER
      </button>

      {videoPresent && (
        <button
          onClick={onClearCache}
          className="mt-3 w-full rounded-lg bg-white/5 px-2 py-1.5 text-center font-mono text-[8px] tracking-[0.15em] text-white/40 transition hover:bg-white/10 hover:text-amber-300"
        >
          CLEAR VIDEO CACHE
        </button>
      )}
    </div>
  )
}
