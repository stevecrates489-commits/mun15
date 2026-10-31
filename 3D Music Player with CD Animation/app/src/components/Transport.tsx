import { useCallback, useEffect, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Shuffle, Repeat, Repeat1 } from 'lucide-react'
import { fmt } from '../features/playlist/usePlaylist'
import { type RepeatMode, type SubscribeTime } from '../hooks/useAudioEngine'

/* progress bar (click / hold-drag scrub) + transport buttons + volume —
   the scrub throttling lives here so timeupdate can't hammer the decoder */
export default function Transport({
  playing,
  subscribeTime,
  duration,
  shuffle,
  repeat,
  volume,
  onPrev,
  onNext,
  onToggle,
  onToggleShuffle,
  onCycleRepeat,
  onSetVolume,
  onSeekTo,
}: {
  playing: boolean
  subscribeTime: SubscribeTime
  duration: number
  shuffle: boolean
  repeat: RepeatMode
  volume: number
  onPrev: () => void
  onNext: () => void
  onToggle: () => void
  onToggleShuffle: () => void
  onCycleRepeat: () => void
  onSetVolume: (v: number) => void
  onSeekTo: (t: number) => void
}) {
  const scrubbingRef = useRef(false)
  const lastScrubRef = useRef(0)
  /* the clock is painted straight into the DOM: a React state tick here
     measured 13ms × 4/s of main-thread time for zero visual gain. React
     never rewrites these nodes because its own props stay at '0%' */
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const applyClock = useCallback(
    (t: number) => {
      const p = duration ? t / duration : 0
      if (elapsedRef.current) elapsedRef.current.textContent = fmt(t)
      if (fillRef.current) fillRef.current.style.width = `${p * 100}%`
      if (thumbRef.current) thumbRef.current.style.left = `${p * 100}%`
    },
    [duration],
  )
  useEffect(() => subscribeTime(applyClock), [subscribeTime, applyClock])

  const seekFromBar = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    onSeekTo(ratio * duration)
  }
  const onSeekBar = (e: React.PointerEvent<HTMLDivElement>) => {
    seekFromBar(e)
    scrubbingRef.current = true
    lastScrubRef.current = 0
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }
  const onSeekMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    const now = performance.now()
    if (now - lastScrubRef.current < 120) return /* don't hammer the decoder */
    lastScrubRef.current = now
    seekFromBar(e)
  }
  const onSeekRelease = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    seekFromBar(e) /* land exactly where the cursor is */
  }

  return (
    <>
      {/* progress */}
      <div
        className="group relative h-6 cursor-pointer"
        onPointerDown={onSeekBar}
        onPointerMove={onSeekMove}
        onPointerUp={onSeekRelease}
        onPointerCancel={onSeekRelease}
      >
        <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded bg-white/15" />
        <div
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded"
          ref={fillRef}
          style={{
            width: '0%',
            /* the accent the art picked — defaults to the deck's own colours */
            background: 'linear-gradient(90deg,var(--accent-a,#7dd8ff),var(--accent-b,#c99cff),var(--accent-a,#ff9dd8))',
            boxShadow: '0 0 10px var(--accent-glow,rgba(160,140,255,0.8))',
          }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 transition-transform group-hover:scale-125"
          ref={thumbRef}
          style={{
            left: '0%',
            background: 'radial-gradient(circle at 35% 30%, #fff, #aab 60%, #556)',
            boxShadow: '0 0 12px rgba(255,255,255,0.7)',
          }}
        />
      </div>
      <div className="mb-5 flex justify-between font-mono text-[10px] text-white/50">
        <span ref={elapsedRef}>0:00</span>
        <span>{fmt(duration)}</span>
      </div>

      {/* transport */}
      <div className="mb-6 flex items-center gap-3">
        <ChromeButton onClick={onPrev} label="Previous">
          <SkipBack size={18} fill="currentColor" />
        </ChromeButton>
        <ChromeButton onClick={onToggle} label="Play / Pause" big>
          {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
        </ChromeButton>
        <ChromeButton onClick={onNext} label="Next">
          <SkipForward size={18} fill="currentColor" />
        </ChromeButton>
        <ModeButton active={shuffle} onClick={onToggleShuffle} label="Shuffle">
          <Shuffle size={13} />
        </ModeButton>
        <ModeButton
          active={repeat !== 'off'}
          onClick={onCycleRepeat}
          label={`Repeat: ${repeat}`}
          badge={repeat === 'one'}
        >
          {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
        </ModeButton>
        <div className="ml-auto flex min-w-[70px] flex-1 items-center gap-2">
          <button
            onClick={() => onSetVolume(volume > 0 ? 0 : 0.85)}
            className="text-white/60 transition hover:text-white"
          >
            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onSetVolume(Number(e.target.value))}
            className="chrome-range w-full"
          />
        </div>
      </div>
    </>
  )
}

function ChromeButton({
  children,
  onClick,
  label,
  big,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  big?: boolean
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`grid place-items-center rounded-full text-black transition-transform duration-150 hover:scale-105 active:scale-95 ${
        big ? 'h-16 w-16' : 'h-11 w-11'
      }`}
      style={{
        background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 30%,#8d959f 55%,#e8ecf1 78%,#9aa2ac 100%)',
        boxShadow:
          'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -2px 3px rgba(0,0,0,0.25), 0 6px 16px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.15)',
      }}
    >
      {children}
    </button>
  )
}

/* playback mode toggle: shuffle / repeat — chrome when armed */
function ModeButton({
  active,
  onClick,
  label,
  badge,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  badge?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative grid h-9 w-9 place-items-center rounded-full transition-all duration-150 hover:scale-105 active:scale-95 ${
        active ? 'text-black' : 'text-white/45 hover:text-white'
      }`}
      style={
        active
          ? {
              background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
              boxShadow:
                'inset 0 1px 1px rgba(255,255,255,0.9), 0 0 18px rgba(110,231,183,0.30), 0 0 0 1px rgba(110,231,183,0.55)',
            }
          : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }
      }
    >
      {children}
      {active && badge && (
        <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.95)]" />
      )}
    </button>
  )
}
