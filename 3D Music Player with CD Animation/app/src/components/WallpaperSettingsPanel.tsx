import { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { readFrameBars, writeFrameBars } from '../lib/frameBars'
import { MAX_SECONDS as WALL_MAX_SECONDS, FPS_MIN, FPS_MAX, type WallPreset, type WallpaperRecord } from '../lib/wallpaperPipeline'

/* Glass quality (item: "be careful with backdrop-filter"). A blur is
   re-evaluated against its backdrop whenever the backdrop changes, and a live
   wallpaper changes it every frame — so this one switch trades the frosted
   panes for their flat dark fills across the whole app. The governor drops
   the same thing automatically when frames go bad; this is for the user who
   would rather keep them anyway. */
function GlassSwitch() {
  const [on, setOn] = useState(() => localStorage.getItem('md-glass') !== 'off')
  useEffect(() => {
    document.documentElement.dataset.glass = on ? 'on' : 'off'
    localStorage.setItem('md-glass', on ? 'on' : 'off')
  }, [on])
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">GLASS PANELS</span>
        <span className="font-mono text-[8px] text-white/40">{on ? 'BLURRED' : 'SOLID'}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setOn(true)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.1em] transition ${
            on ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          BLURRED
        </button>
        <button
          onClick={() => setOn(false)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.1em] transition ${
            !on ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          SOLID · FAST
        </button>
      </div>
    </div>
  )
}

/* The frame bars: black bars over the wallpaper, under the interface, that
   breathe with the bass. They used to be baked into the wallpaper files —
   letterboxing, different on every screen. Opt in here. */
function FrameBarsSwitch() {
  const [on, setOn] = useState(readFrameBars)
  const toggle = (next: boolean) => {
    setOn(next)
    writeFrameBars(next)
  }
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">FRAME BARS</span>
        <span className="font-mono text-[8px] text-white/40">{on ? 'BEAT-REACTIVE' : 'OFF'}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => toggle(true)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.1em] transition ${
            on ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          ON
        </button>
        <button
          onClick={() => toggle(false)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.1em] transition ${
            !on ? 'bg-white/90 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          OFF
        </button>
      </div>
    </div>
  )
}

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

  /* release anything the vault has dropped, then hand back a live URL per
     record — stable across renders and across a StrictMode remount */
  pruneThumbCache(new Set(savedWallpapers.map((r) => r.id)))
  const thumbUrls = new Map(savedWallpapers.map((rec): [string, string] => [rec.id, thumbUrlFor(rec)]))

  return (
    <div
      className={`settings-panel fx-blur fixed bottom-[calc(13%+46px)] right-[5%] z-[87] w-72 rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${closing ? ' is-closing' : ''}`}
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
      <GlassSwitch />
      <FrameBarsSwitch />

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

      <div className="mb-3">
        <div className="mb-1.5">
          <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">
            SAVED WALLPAPERS{savedWallpapers.length > 0 ? ` · ${savedWallpapers.length}` : ''}
          </span>
        </div>
        {savedWallpapers.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 px-2.5 py-2 font-mono text-[8px] tracking-[0.1em] text-white/30">
            NO SAVED WALLPAPERS YET
          </div>
        )}
        {savedWallpapers.length > 0 && (
          <div className="max-h-[180px] space-y-1.5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
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
        {/* ADD — full-width outline button, same visual language as the panel's
            other controls; the old corner pill next to the label was cramped */}
        <button
          onClick={onAddNew}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/25 px-3 py-1.5 font-mono text-[8px] tracking-[0.2em] text-white/55 transition hover:border-white/45 hover:text-white"
        >
          <Plus size={10} />
          ADD WALLPAPER
        </button>
      </div>

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
