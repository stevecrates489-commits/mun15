import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import type { AmLyrics } from '@uimaxbai/am-lyrics'
import '@uimaxbai/am-lyrics/am-lyrics.js'
import type { LyricsMode } from '../features/lyrics/useLyrics'

/** private surface of the component we drive through reflection */
interface AmLyricsPriv {
  generateLRC(): string
  generateTTML(): string
  /** force the active line back into view — the explicit "resume" path */
  scrollToActiveLine(force?: boolean): void
}

/* the component ships chrome ABOVE and BELOW the lyrics (a header with
   romanization / translation / download, a footer with the source label, a
   Switch button, songwriters and a version stamp). Neither is reachable by a
   property — only by CSS — and both are useless here, so they are suppressed
   and the two actions worth keeping are re-exposed through LyricsApi for the
   lyrics settings panel.

   The FOOTER must be `visibility: hidden`, NOT `display: none`: the scroll
   range is derived from the last element in the container, and the footer's
   `50vh` bottom padding is what lets the final line travel up the panel.
   Hiding it from layout zeroes its offsetTop/offsetHeight, collapses the
   scroll range to `clientHeight - clientHeight` and pins scrollTop to 0 —
   lyrics highlight in place and never scroll. Hiding it from VIEW keeps the
   box, so the range is intact, and a programmatic `.click()` on the hidden
   Switch button still works.

   The header is the opposite: it sits above the lines, is not part of that
   maths, and leaving it in the flow would only waste panel height. */
const HIDE_CHROME = `
  .lyrics-header { display: none !important; }
  .lyrics-footer {
    visibility: hidden !important;
    pointer-events: none !important;
  }
`

/* the stage position (CD hidden) reads as a showcase, so its lines are
   centred; on the disc they stay left-aligned like a spooling label */
const CENTER_CHROME = `
  .lyrics-line, .lyrics-line-container { text-align: center !important; }
`

/* the line being sung eases up and brightens instead of snapping between
   two states — words over a bright figure are hard enough to read while
   they move, so the motion is short and settles (the app's own curve) */
/* Legibility without a plate: the words sit straight on the wallpaper, and
   the shadow is on the GLYPHS — it follows the text instead of painting a
   rectangle over the artwork. The component's own per-line highlight surface
   is forced transparent for the same reason: a glowing box behind the active
   line reads as exactly the dark slab this panel is not allowed to have. */
const TEXT_CHROME = `
  .lyrics-line,
  .lyrics-line-container {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55), 0 0 12px rgba(0, 0, 0, 0.35) !important;
  }
  .lyrics-line.active,
  .lyrics-line.active .lyrics-line-container {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 0 14px rgba(0, 0, 0, 0.45) !important;
  }
  .lyrics-line::before,
  .lyrics-line.active::before {
    background: transparent !important;
    box-shadow: none !important;
  }
`

const MOTION_CHROME = `
  .lyrics-line {
    transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
                filter 280ms cubic-bezier(0.22, 1, 0.36, 1),
                opacity 280ms cubic-bezier(0.22, 1, 0.36, 1) !important;
    transform-origin: center;
  }
  .lyrics-line.active {
    transform: scale(1.045) !important;
    filter: brightness(1.15) !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .lyrics-line, .lyrics-line.active {
      transition: none !important;
      transform: none !important;
      filter: none !important;
    }
  }
`

export interface LyricsApi {
  /** cycle to another provider's result for the same song */
  switchSource: () => boolean
  /** download the current lyrics (the component's own exporter) */
  download: () => boolean
  /** label of the provider currently serving, e.g. "lrc.red" */
  source: () => string | null
  /** the loaded lyrics as LRC, for the editor to show and re-save */
  extractLrc: () => string
  /** the loaded lyrics as TTML, for pinning locally */
  extractTtml: () => string
  hasLyrics: () => boolean
  /** pull the active line back into view after the user scrolled away */
  resumeScroll: () => void
}

interface Props {
  title: string
  artist: string
  /* seconds — sent to the providers and used for instrumental gaps.
     -1 marks a live stream: no length, so no position and no sync */
  duration: number
  /* live radio — the playhead comes from the song clock, not the engine */
  live?: boolean
  playing: boolean
  /* true playhead, sampled per frame (the engine's clock is 4Hz, too coarse
     for word-by-word interpolation) */
  getTime: () => number
  onSeek: (seconds: number) => void
  /* base font size in px — the lyrics sit on the disc, so the user tunes it */
  size: number
  /* which of the three positions this instance occupies */
  mode: LyricsMode
  /* 20-160, applied as a CSS filter so bright artwork can be read through */
  brightness: number
  /* seconds added to the playhead, to correct a mis-timed source */
  offset: number
  /* a TTML string: fed to `ttml`, which skips every network request. Used
     for a locally pinned lyric, and for the radio, whose lyrics come from
     the song clock's own source */
  ttml?: string | null
  /* filled with the imperative controls the settings panel and editor drive */
  apiRef: React.RefObject<LyricsApi | null>
}

/**
 * Host for the `<am-lyrics>` web component (Lit + Shadow DOM).
 *
 * Three rules come straight from the component's source and are easy to get
 * wrong, so:
 *
 *  1. `connectedCallback` starts a fetch, and `updated()` starts ANOTHER
 *     whenever songTitle / songArtist / songDurationMs change. So EVERY
 *     property is written BEFORE the element is appended — appending first
 *     would fire a wasted metadata-less fetch and then a second real one.
 *  2. Setting `ttml` makes the component render that string and skip ALL
 *     providers. That is the local-pin path, and it is checked first.
 *  3. The element is rebuilt only when the song's identity changes. Writing a
 *     property afterwards re-triggers the fetch, so the playhead and any later
 *     duration correction are never pushed as a property change.
 *
 * The element is kept alive while the panel is hidden (the container's opacity
 * animates), so re-showing the lyrics never re-fetches.
 */
export default function LyricsPanel({
  title,
  artist,
  duration,
  live = false,
  playing,
  getTime,
  onSeek,
  size,
  mode,
  brightness,
  offset,
  ttml,
  apiRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<AmLyrics | null>(null)
  /* true while the user has taken the wheel away from autoscroll — drives the
     3-second return bar. Works in every position (on disc, beside disc, stage)
     because it listens on the panel itself, not on the layout. */
  const [scrolled, setScrolled] = useState(false)
  const resumeRef = useRef<() => void>(() => {})
  /* The countdown: one timer, one token. The token is bumped whenever the
     element is rebuilt, so a timer aimed at a song that has already ended
     can never fire into — and cancel — the next song's countdown. */
  const returnTimerRef = useRef<number | undefined>(undefined)
  const returnTokenRef = useRef(0)
  const barRef = useRef<HTMLSpanElement>(null)

  /* the listener and the clock must survive element rebuilds without
     re-attaching, and both are mirrored into refs (synced in effects — the
     react-hooks compiler rejects a write during render). The engine's
     getTime is stable, but this keeps the playhead effect's deps at [playing]
     so a track change re-syncs through the creation effect instead */
  const seekRef = useRef(onSeek)
  const getTimeRef = useRef(getTime)
  const offsetRef = useRef(offset)
  useEffect(() => {
    seekRef.current = onSeek
    getTimeRef.current = getTime
    offsetRef.current = offset
  }, [onSeek, getTime, offset])

  /* undefined until metadata lands: a 0 duration would still count as a
     CHANGE once the real one arrives, rebuilding the element and re-fetching */
  const ms = duration > 0 ? Math.round(duration * 1000) : undefined
  /* the song's identity: also what a stored lyric changes, so "scrolled away"
     never survives a pinned/unpinned switch either */
  const songKey = `${ttml ? 'tt' : ''}${title}\u0000${artist}`

  useEffect(() => {
    const host = hostRef.current
    if (!host || !title) return
    const el = document.createElement('am-lyrics') as unknown as AmLyrics
    /* props FIRST — see note 1 above */
    if (ttml) {
      /* a pinned/custom lyric, or the radio's own: no songTitle is needed and
         no request is made */
      el.ttml = ttml
    } else if (live) {
      /* Live radio. The song HAS a position — the clock dead-reckons it from
         the announcement — so the component is NOT told "no clock" (that
         would clear the highlight and pretend no line is being sung).

         `duration` is deliberately left unset: it is a matching hint for the
         providers, and a guess would be worse than none. The highlight is
         driven entirely by `currentTime`, which the playhead below feeds it
         from the clock. */
      el.songTitle = title
      el.songArtist = artist
    } else {
      el.songTitle = title
      el.songArtist = artist
      el.songDurationMs = ms
      el.duration = ms
      /* free-text fallback for the providers that only take a query */
      el.query = artist ? `${title} ${artist}` : title
    }
    el.highlightColor = '#eaf2ff'
    el.fontFamily = "'Space Grotesk', sans-serif"
    el.autoScroll = true
    el.interpolate = true
    el.style.display = 'block'
    el.style.height = '100%'
    /* the previous element held the old timeline — start this one at the
       engine's real position so a paused track switch can never desync */
    el.currentTime = Math.max(0, getTimeRef.current() * 1000)
    host.appendChild(el)
    elRef.current = el

    const onLineClick = (e: Event) => {
      const t = (e as CustomEvent<{ timestamp?: number }>).detail?.timestamp
      if (typeof t === 'number') seekRef.current(t / 1000)
    }
    el.addEventListener('line-click', onLineClick)

    /* strip the built-in chrome. Kept in a constructed sheet and adopted on a
       frame (Lit installs its own styles in a microtask after connect, so
       adopting earlier would be overwritten). CSS, not DOM pokes: the footer
       only exists once a fetch lands, and a style rule applies whenever it
       appears */
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(
      HIDE_CHROME + TEXT_CHROME + MOTION_CHROME + (mode === 'stage' ? CENTER_CHROME : ''),
    )
    const raf = requestAnimationFrame(() => {
      const root = el.shadowRoot
      if (root && !root.adoptedStyleSheets.includes(sheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      }
    })

    /* the controls worth keeping, driven from the lyrics settings panel */
    const priv = el as unknown as AmLyricsPriv
    const q = <T extends Element>(sel: string) => el.shadowRoot?.querySelector<T>(sel) ?? null
    apiRef.current = {
      switchSource: () => q<HTMLButtonElement>('.source-switch-btn')?.click() ?? false,
      download: () => q<HTMLButtonElement>('.download-controls .download-button')?.click() ?? false,
      source: () => {
        const t = q<HTMLElement>('.source-info')?.textContent ?? ''
        return t.replace(/^\s*Source\s*/i, '').trim() || null
      },
      extractLrc: () => {
        try {
          return priv.generateLRC?.() ?? ''
        } catch {
          return ''
        }
      },
      extractTtml: () => {
        try {
          return priv.generateTTML?.() ?? ''
        } catch {
          return ''
        }
      },
      hasLyrics: () => !!el.shadowRoot?.querySelector('.lyrics-line'),
      resumeScroll: () => {
        const root = el.shadowRoot
        const c = root?.querySelector('.lyrics-container') as HTMLElement | null
        if (!c) return
        /* Scroll directly, to the same target the component computes
           (`offsetTop - 45% of the container`). Driving the element's own
           scroll handler instead of calling its legacy
           `scrollToActiveLine` matters: that one centres on
           `containerHeight / 2`, so the line sat visibly lower after a
           resume than it did during playback. */
        const active = root!.querySelector('.lyrics-line.active') as HTMLElement | null
        const pad = c.clientHeight * 0.45
        c.scrollTo({ top: active ? Math.max(0, active.offsetTop - pad) : 0, behavior: 'smooth' })
        /* and re-arm autoscroll so it holds position instead of drifting back */
        const t = getTimeRef.current()
        el.currentTime = t + 0.001
      },
    }
    resumeRef.current = apiRef.current?.resumeScroll ?? (() => {})

    /* a rebuilt element leaves no countdown behind: the old one would resume
       the NEW song early (or cancel its bar), so it is invalidated here and
       the bar comes down with it */
    returnTokenRef.current += 1
    if (returnTimerRef.current) {
      window.clearTimeout(returnTimerRef.current)
      returnTimerRef.current = undefined
    }
    setScrolled(false)

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('line-click', onLineClick)
      elRef.current = null
      apiRef.current = null
      el.remove()
    }
  }, [title, artist, ms, ttml, apiRef, mode, live])

  /* Playhead. One sync while paused, a frame loop while playing — the same
     pattern the component's own README recommends. Never React state: a tick
     per frame would re-render the whole Home tree, which is exactly what
     useAudioEngine's out-of-state clock exists to avoid.

     The radio takes the same road: `getTime` is the song clock there, so the
     highlight follows the dead-reckoned position exactly as it follows the
     engine's own clock for a library track. What changed for the radio is
     that the component is no longer told it has no clock at all.

     `el` is re-read EVERY tick, never closed over: the element is rebuilt when
     the song's identity changes (and once, if the track's duration lands after
     the panel opens). A captured reference would keep writing to the detached
     element and the live one would freeze at its first frame. */
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    el.currentTime = Math.max(0, (getTimeRef.current() + offsetRef.current) * 1000)
    if (!playing) return
    let raf = 0
    const tick = () => {
      const current = elRef.current
      if (current) current.currentTime = Math.max(0, (getTimeRef.current() + offsetRef.current) * 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, live])

  /* wheel / touch on the words means the user is reading, not following.
     The old Resume button is gone: scrolling starts a VISIBLE 3-second
     countdown instead, and when the bar fills the view is handed back to the
     line being sung — which also retires the component's own silent 5-second
     quiet-spell timeout (cleared here, so3s is the only clock that decides). */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onUser = () => {
      const token = ++returnTokenRef.current
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
      returnTimerRef.current = window.setTimeout(() => {
        returnTimerRef.current = undefined
        if (token !== returnTokenRef.current) return /* a newer song took over */
        /* retire the library's own quiet-spell timer so it cannot second-
           guess this one, then pull the active line back into view */
        const el = elRef.current as unknown as {
          userScrollTimeoutId?: number
          setUserScrolling?: (v: boolean) => void
        } | null
        if (el) {
          if (el.userScrollTimeoutId) {
            window.clearTimeout(el.userScrollTimeoutId)
            el.userScrollTimeoutId = undefined
          }
          el.setUserScrolling?.(false)
        }
        resumeRef.current()
        setScrolled(false)
      }, 3000)
      setScrolled(true)
      /* restart the fill from zero so it lands exactly when the timer does —
         a state update per wheel tick would re-render for nothing */
      const anim = barRef.current?.getAnimations()[0]
      if (anim) anim.currentTime = 0
    }
    host.addEventListener('wheel', onUser, { passive: true })
    host.addEventListener('touchmove', onUser, { passive: true })
    return () => {
      host.removeEventListener('wheel', onUser)
      host.removeEventListener('touchmove', onUser)
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
    }
  }, [])

  /* a fresh song — or a rebuilt element — puts the reader back at the top, so
     "scrolled away" must not survive the switch. The previous-key pattern is
     the supported way to reset state when an identity changes, and it needs no
     effect (which would flash the button for a frame) and no render-phase
     writes (which the compiler rightly rejects). */
  const [scrolledFor, setScrolledFor] = useState(songKey)
  if (scrolledFor !== songKey) {
    setScrolledFor(songKey)
    if (scrolled) setScrolled(false)
  }

  const vars = {
    '--lyplus-font-size-base': `${size}px`,
    '--am-lyrics-line-height': mode === 'stage' ? '1.16' : '1.22',
    '--am-lyrics-line-spacing': `${Math.round(size * 0.55)}px`,
    '--am-lyrics-background-vocal-font-size': '0.7em',
    '--am-lyrics-inactive-scale': '0.97',
    '--am-lyrics-highlight-radius': '10px',
    '--am-lyrics-compact-font-size': `${size}px`,
    '--am-lyrics-compact-line-spacing': `${Math.round(size * 0.55)}px`,
    '--am-lyrics-wide-font-size': `${size}px`,
    '--am-lyrics-wide-line-spacing': `${Math.round(size * 0.55)}px`,
    /* park the active line mid-panel. `--lyrics-scroll-padding-top` is a
       percentage of the container's height (read by getScrollPaddingTop) and
       is what the active line is aligned to — 0% would pin it to the panel's
       top edge, straight under the fade mask, with all the context below */
    '--am-lyrics-compact-selected-position': '50%',
    '--am-lyrics-wide-selected-position': '50%',
    '--lyrics-scroll-padding-top': '45%',
  } as React.CSSProperties

  return (
    <div className="relative h-full w-full">
      {/* no pool, no plate, no blurred box — the words sit straight on the
          wallpaper, and TEXT_CHROME below is what keeps them readable */}
      <div
        ref={hostRef}
        className="lyrics-host h-full w-full"
        style={{
          ...vars,
          /* brightness is a filter on the whole component — the disc has the
             same control, and words over bright artwork need the same treatment */
          filter: brightness !== 100 ? `brightness(${brightness / 100})` : undefined,
          maskImage: 'linear-gradient(180deg,transparent,black 9%,black 91%,transparent)',
          WebkitMaskImage: 'linear-gradient(180deg,transparent,black 9%,black 91%,transparent)',
        }}
      />
      {/* the countdown itself: a pill naming where the view is headed, with
          the 3-second bar filling along its bottom edge */}
      {scrolled && (
        <div className="lyrics-return settings-panel absolute bottom-2 left-1/2 z-[70] -translate-x-1/2 overflow-hidden rounded-full border border-white/15 bg-black/80 px-3 py-1 backdrop-blur-md">
          <span className="flex items-center gap-1.5 font-mono text-[7px] tracking-[0.18em] text-white/60">
            <Clock size={9} />
            CURRENT LINE
          </span>
          <span
            ref={barRef}
            className="lyrics-return-bar absolute bottom-0 left-0 h-[2px] w-full origin-left bg-emerald-400"
          />
        </div>
      )}
    </div>
  )
}
