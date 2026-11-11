import { useEffect, useRef } from 'react'
import Transport from './Transport'
import { liquidGlass } from '../lib/liquidGlass'
import { type RepeatMode, type SubscribeTime } from '../hooks/useAudioEngine'

/* The music control panel — the transport, housed in its own cast-glass
 * body instead of floating loose in the deck column.
 *
 * The refraction is applied DIRECTLY to this panel's root: unlike the
 * tracklist, nothing else writes backdrop-filter here (no scroll frost),
 * so there is no fight. The surface is small (~420×140), which is exactly
 * the budget liquid refraction is for — the big panels stay plain glass.
 * All playback props pass through untouched: this is a body, not a brain.
 */
export default function MusicControlPanel({
  playing,
  subscribeTime,
  duration,
  shuffle,
  repeat,
  volume,
  favourite,
  onToggleFavourite,
  onPrev,
  onNext,
  onToggle,
  onToggleShuffle,
  onCycleRepeat,
  onSetVolume,
  onSeekTo,
  radioOn,
  radioLive,
  onRadioHoldStart,
  onRadioHoldEnd,
  onRadioHoldLeave,
  onRadioClick,
  wallSettingsOpen,
  onToggleWallSettings,
}: {
  playing: boolean
  subscribeTime: SubscribeTime
  duration: number
  shuffle: boolean
  repeat: RepeatMode
  volume: number
  /** the playing track's favourite state */
  favourite: boolean
  onToggleFavourite: () => void
  onPrev: () => void
  onNext: () => void
  onToggle: () => void
  onToggleShuffle: () => void
  onCycleRepeat: () => void
  onSetVolume: (v: number) => void
  onSeekTo: (t: number) => void
  /** the stage toggles that moved inside so they scale with this panel */
  radioOn: boolean
  radioLive: boolean
  onRadioHoldStart: () => void
  onRadioHoldEnd: () => void
  onRadioHoldLeave: () => void
  /** plain click on the radio button (edit mode's hold-free path) */
  onRadioClick: () => void
  wallSettingsOpen: boolean
  onToggleWallSettings: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const glass = liquidGlass(el, { scale: -58, chroma: 3, blur: 2, saturate: 1.25, fallbackBlur: 14 })
    return () => glass.destroy()
  }, [])

  return (
    <div
      ref={panelRef}
      className="music-control-glass fade-in relative mt-1 flex flex-col rounded-2xl border border-white/10 px-4 pb-3 pt-2 shadow-[0_16px_44px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      <Transport
        playing={playing}
        subscribeTime={subscribeTime}
        duration={duration}
        shuffle={shuffle}
        repeat={repeat}
        volume={volume}
        favourite={favourite}
        onToggleFavourite={onToggleFavourite}
        onPrev={onPrev}
        onNext={onNext}
        onToggle={onToggle}
        onToggleShuffle={onToggleShuffle}
        onCycleRepeat={onCycleRepeat}
        onSetVolume={onSetVolume}
        onSeekTo={onSeekTo}
        radioOn={radioOn}
        radioLive={radioLive}
        onRadioHoldStart={onRadioHoldStart}
        onRadioHoldEnd={onRadioHoldEnd}
        onRadioHoldLeave={onRadioHoldLeave}
        onRadioClick={onRadioClick}
        wallSettingsOpen={wallSettingsOpen}
        onToggleWallSettings={onToggleWallSettings}
      />
    </div>
  )
}
