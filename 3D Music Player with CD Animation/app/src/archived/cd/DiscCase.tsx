/* ============================================================================
 * ARCHIVED — the CD is gone from the player.
 *
 * Nothing outside `src/archived/` imports this file, so it is tree-shaken out
 * of the bundle and never reaches the screen. It is kept so the feature can
 * come back without being rewritten. See ./README.md for the restore steps.
 * ========================================================================== */
import { useEffect, useLayoutEffect, useRef } from 'react'
import discUrl from './assets/disc.png'
import chromeUrl from './assets/chrome.png'

interface Props {
  playing: boolean
  onToggle: () => void
  onScratch: (deltaSeconds: number) => void
  cover?: string | null
  bpm?: number | null
  analyser: () => AnalyserNode | null
  reactive: boolean
  /* user-supplied disc art — falls back to the stock holographic disc */
  discArt?: string | null
  /* the face is an unprinted square photo (a track cover). Printed faces —
     the uploaded label, the stock disc — already carry a centre, so the hub
     hole is drawn only for this one */
  hubHole?: boolean
  /* identity of the disc currently on the platter (the track id). A change
     runs the exchange animation. Artwork alone can't drive it: two tracks
     can share a cover, and the user asked for a swap on every track change */
  faceKey?: string | number | null
  /* the exchange is only meaningful when the track's own cover is the face.
     A playlist poster belongs to the playlist, and the uploaded/stock face is
     a fixture — neither is a disc being changed, so they cut straight over */
  swapEnabled?: boolean
  /* rotation multiplier — 0 stops the disc, 1 is the natural BPM cruise, 2 doubles */
  speedScale?: number
  /* frosted glass only when a custom wallpaper sits behind the case —
      backdrop-filter is re-evaluated every frame against a repainting
      backdrop (visualiser canvas + glow), so default themes get static glass */
  frosted?: boolean
}

/**
 * The transparent MiniDisc cartridge: glass case, spinning holographic disc,
 * engraved label, chrome tribal armour, cursor tilt + disc scratching.
 * The disc's speed follows the track's BPM and the rainbow sheens can react
 * to the music's spectrum.
 */
export default function DiscCase({
  playing,
  onToggle,
  onScratch,
  cover,
  bpm,
  analyser,
  reactive,
  discArt,
  hubHole = false,
  faceKey = null,
  swapEnabled = true,
  speedScale = 1,
  frosted,
}: Props) {
  const tiltRef = useRef<HTMLDivElement>(null)
  const discGroupRef = useRef<HTMLDivElement>(null)
  const chromeARef = useRef<HTMLImageElement>(null)
  const chromeBRef = useRef<HTMLImageElement>(null)
  const caseRef = useRef<HTMLDivElement>(null)
  const sheenARef = useRef<HTMLDivElement>(null)
  const sheenBRef = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)

  const angleRef = useRef(0)
  const speedRef = useRef(0)
  const playingRef = useRef(playing)
  playingRef.current = playing

  const scratchRef = useRef<{
    active: boolean
    lastAngle: number
    movedAngle: number
    /* angular velocity in deg/s — what the flick was doing when the finger
       left, so the disc keeps turning and settles instead of stopping dead */
    vel: number
    at: number
  }>({
    active: false,
    lastAngle: 0,
    movedAngle: 0,
    vel: 0,
    at: 0,
  })
  const burstRef = useRef(0)
  /* tilt spring: target from cursor, rendered through spring physics */
  const tiltTargetRef = useRef({ tx: 0, ty: 0 })
  const tiltSpringRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 })

  /* live prop mirrors for the animation loop */
  const bpmRef = useRef<number | null>(bpm ?? null)
  bpmRef.current = bpm ?? null
  const reactiveRef = useRef(reactive)
  reactiveRef.current = reactive
  const speedScaleRef = useRef(speedScale)
  speedScaleRef.current = speedScale
  const analyserRef = useRef(analyser)
  analyserRef.current = analyser

  /* ---- the disc on the platter, and the exchange that changes it ---- */
  const discImgRef = useRef<HTMLImageElement>(null)
  const faceSrcRef = useRef(discArt ?? discUrl)
  faceSrcRef.current = discArt ?? discUrl
  const faceKeySeenRef = useRef(faceKey)
  const swapTokenRef = useRef(0)
  const swapBusyRef = useRef(false)

  /* A new track swaps the disc: the old face lifts off and fades on a
     short-lived duplicate, while the new one sweeps in from the left,
     overshoots a hair and settles. The spin angle lives on the group, so the
     arriving disc inherits the exact rotation the old one had — the platter
     never stops or resets, which is what makes this read as a disc change
     instead of an image swap.

     A LAYOUT effect on purpose: React must never paint the new art before the
     duplicate covers it, or the swap opens with a hard cut on frame one. */
  useLayoutEffect(() => {
    const img = discImgRef.current
    const group = discGroupRef.current
    if (!img || !group) return

    const next = discArt ?? discUrl
    const trackChanged = faceKey !== faceKeySeenRef.current

    if (!trackChanged) {
      /* toggling a cover layer or uploading a label is not a disc change —
         the face updates in place. Mid-swap the tail of that swap reconciles
         to the latest art, so leave it alone here. */
      if (!swapBusyRef.current && img.getAttribute('src') !== next) img.src = next
      return
    }
    faceKeySeenRef.current = faceKey

    /* a face that isn't the playing track's cover never swaps: the poster is
       the playlist's, and the default/stock face is a fixture. Updating the
       src in place is the whole change. */
    if (!swapEnabled) {
      if (img.getAttribute('src') !== next) img.src = next
      return
    }

    /* cancel whatever is running and sweep earlier duplicates: holding next
       must never stack ghosts or leave two discs on the platter */
    const token = ++swapTokenRef.current
    const midSwap = swapBusyRef.current
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    swapBusyRef.current = true
    img.getAnimations().forEach((a) => a.cancel())
    group.querySelectorAll('[data-disc-ghost]').forEach((el) => el.remove())
    img.style.opacity = ''
    img.style.transform = ''

    const ghost = img.cloneNode(true) as HTMLImageElement
    ghost.removeAttribute('alt')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.setAttribute('data-disc-ghost', '')
    ghost.style.pointerEvents = 'none'
    ghost.style.zIndex = '2'
    group.appendChild(ghost)

    img.src = next
    img.style.zIndex = '1'
    img.style.opacity = '0'
    /* the resting offset lives HERE, not only in the keyframes: a fade-only
       swap (reduced motion / rapid skipping) must not leave the disc parked
       a disc-width to the left */
    img.style.transform = midSwap || reduced ? 'none' : 'translate3d(-46%, 0, 0) scale(1.14) rotate(-6deg)'

    void (async () => {
      /* never slide an undecoded frame in — that is the art popping into view
         halfway down the swoop. The race keeps a slow decode from parking the
         old disc on screen: 120ms is longer than any 1024px cover needs */
      try {
        await Promise.race([
          img.decode().catch(() => {}),
          new Promise<void>((res) => window.setTimeout(res, 120)),
        ])
      } catch {
        /* decode is advisory — the animation still runs on the cached frame */
      }
      if (token !== swapTokenRef.current) {
        ghost.remove()
        return
      }

      /* rapid skipping gets a short crossfade: restarting the full swoop
         mid-flight would snap the outgoing disc back to full opacity */
      const quick = midSwap || reduced
      const inAnim = img.animate(
        quick
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translate3d(-46%, 0, 0) scale(1.14) rotate(-6deg)' },
              { opacity: 0.55, offset: 0.4 },
              { opacity: 1, transform: 'none' },
            ],
        {
          duration: quick ? 200 : 520,
          easing: quick ? 'ease-out' : 'cubic-bezier(.16, 1, .3, 1)',
          fill: 'both',
        },
      )
      const outAnim = ghost.animate(
        quick
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: 'none' },
              { opacity: 0.45, offset: 0.45 },
              { opacity: 0, transform: 'translate3d(26%, -16%, 0) scale(0.9) rotate(6deg)' },
            ],
        {
          duration: quick ? 200 : 450,
          easing: quick ? 'ease-out' : 'cubic-bezier(.4, 0, .3, 1)',
          fill: 'both',
        },
      )
      await Promise.all([inAnim.finished.catch(() => {}), outAnim.finished.catch(() => {})])
      ghost.remove()
      if (token !== swapTokenRef.current) return
      /* commit the resting state BEFORE cancelling — a cancelled fill reverts
         to its start frame for one paint (the old disc flashing back) */
      img.style.opacity = ''
      img.style.transform = ''
      img.style.zIndex = ''
      img.src = faceSrcRef.current
      inAnim.cancel()
      outAnim.cancel()
      swapBusyRef.current = false
    })()
  }, [faceKey, discArt, swapEnabled])

  /* a swap interrupted by unmount must not leave a duplicate behind */
  useEffect(
    () => () => {
      swapTokenRef.current++
      discImgRef.current?.getAnimations().forEach((a) => a.cancel())
      discGroupRef.current?.querySelectorAll('[data-disc-ghost]').forEach((el) => el.remove())
    },
    [],
  )

  /* ---- motion engine: spin + spring tilt ----
     the spin is JS-driven and dual-clocked: rAF when frames flow (60fps),
     a 100ms heartbeat when the tab starves them (never fully frozen) ---- */
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastSpinAt = performance.now()
    let frame = 0
    const written = { angle: -999, x: 0, y: 0, op: -1, hue: 0, hueOn: false, bass: -999, filterAt: 0 }
    const freq = new Uint8Array(256)

    const applySpin = (dt: number, t: number) => {
      if (!scratchRef.current.active) {
        /* BPM-reactive: fast songs spin the disc faster. The multiplier scales
           the whole target: 0 holds the disc completely still, 1 is the
           natural cruise, 2 doubles it — and rotation happens only while the
           audio is actually playing. The ease below is what makes a speed
           change glide instead of snap. */
        const bpm = bpmRef.current
        const cruise = bpm ? Math.min(240, Math.max(105, bpm * 1.05)) : 150
        const target =
          playingRef.current && speedScaleRef.current > 0 ? cruise * speedScaleRef.current : 0
        speedRef.current += (target - speedRef.current) * (1 - Math.exp(-dt * 1.6))
        if (burstRef.current > 0.05) burstRef.current *= Math.exp(-dt * 4.2)
        else burstRef.current = 0
        const flutter = 1 + 0.02 * Math.sin(t * 2.3) + 0.012 * Math.sin(t * 3.9)
        angleRef.current = (angleRef.current + speedRef.current * flutter * dt + burstRef.current * dt) % 360
        if (angleRef.current < 0) angleRef.current += 360
      }
      lastSpinAt = performance.now()
      const angle = angleRef.current
      if (Math.abs(angle - written.angle) > 0.05) {
        written.angle = angle
        if (discGroupRef.current) discGroupRef.current.style.transform = `rotate(${angle}deg)`
      }

      /* music-reactive rainbow: bass pulls deep reds/purples, highs pull cyan */
      frame++
      if (frame % 4 === 0) {
        const an = analyserRef.current()
        if (reactiveRef.current && an && playingRef.current) {
          an.getByteFrequencyData(freq)
          let bass = 0
          let high = 0
          for (let k = 2; k < 14; k++) bass += freq[k]
          for (let k = 60; k < 110; k++) high += freq[k]
          bass /= 12 * 255
          high /= 50 * 255
          const targetHue = Math.max(-110, Math.min(110, (high - bass) * 150))
          const prevHue = written.hue
          const prevBass = written.bass
          written.hue += (targetHue - written.hue) * 0.25
          written.bass = bass
          /* rewrite the sheen filters only when they moved perceptibly — each
             style write re-rasterizes the masked screen-blend sheen layers, and
             the smoothed values sit below these deltas most frames once settled.
             Time-gated to 10Hz as well: a style write triggers a paint of the
             blend layers, so even passing deltas can't fire every frame. */
          const moved = Math.abs(written.hue - prevHue) > 0.15 || Math.abs(bass - prevBass) > 0.008
          const nowMs = performance.now()
          if (!written.hueOn || (moved && nowMs - written.filterAt >= 200)) {
            if (sheenARef.current) sheenARef.current.style.filter = `hue-rotate(${written.hue.toFixed(1)}deg) saturate(${(1.1 + bass * 0.5).toFixed(2)})`
            if (sheenBRef.current) sheenBRef.current.style.filter = `hue-rotate(${(-written.hue * 0.7).toFixed(1)}deg)`
            written.hueOn = true
            written.filterAt = nowMs
          }
        } else if (written.hueOn) {
          written.hueOn = false
          if (sheenARef.current) sheenARef.current.style.filter = ''
          if (sheenBRef.current) sheenBRef.current.style.filter = ''
        }
      }
    }

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const t = now / 1000
      applySpin(dt, t)

      /* tilt spring: quick to follow the cursor, slow and gentle settling home.
         while idle it drifts on a faint micro-float so the model never dies */
      const s = tiltSpringRef.current
      const { tx: baseTx, ty: baseTy } = tiltTargetRef.current
      const returning = baseTx === 0 && baseTy === 0
      const tx = returning ? Math.sin(t * 0.7) * 0.02 : baseTx
      const ty = returning ? Math.cos(t * 0.5) * 0.016 : baseTy
      const stiffness = returning ? 34 : 200
      const damping = returning ? 14.5 : 26
      s.vx += ((tx - s.x) * stiffness - s.vx * damping) * dt
      s.vy += ((ty - s.y) * stiffness - s.vy * damping) * dt
      s.x += s.vx * dt
      s.y += s.vy * dt

      if (Math.abs(s.x - written.x) > 0.0004 || Math.abs(s.y - written.y) > 0.0004) {
        written.x = s.x
        written.y = s.y
        if (caseRef.current)
          caseRef.current.style.transform = `rotateY(${s.x * 14}deg) rotateX(${-s.y * 14}deg)`
        if (chromeARef.current)
          chromeARef.current.style.transform = `translate3d(${s.x * 26}px, ${s.y * 26}px, 70px)`
        if (chromeBRef.current)
          chromeBRef.current.style.transform = `translate3d(${s.x * -18}px, ${s.y * -18}px, 45px) rotate(180deg)`
        if (glareRef.current)
          glareRef.current.style.transform = `translate3d(${s.x * 38}px, ${s.y * 38}px, 0) rotate(${s.x * 22}deg)`
      }
      const op = 0.55 + Math.min(0.35, Math.abs(s.x) + Math.abs(s.y))
      if (Math.abs(op - written.op) > 0.004) {
        written.op = op
        if (sheenARef.current) sheenARef.current.style.opacity = String(op)
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    /* heartbeat: keeps the disc alive when the tab starves rAF entirely */
    const heartbeat = window.setInterval(() => {
      const elapsed = (performance.now() - lastSpinAt) / 1000
      if (elapsed > 0.12) applySpin(Math.min(elapsed, 0.5), performance.now() / 1000)
    }, 100)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(heartbeat)
    }
  }, [])

  /* ---- scratch safety net: a lost pointerup must never freeze the motor ---- */
  useEffect(() => {
    const release = () => {
      if (!scratchRef.current.active) return
      scratchRef.current.active = false
      /* hand the flick's speed to the motor: it decays back to the cruise
         (or to a stop, when paused) instead of cutting out on release */
      speedRef.current = Math.max(-1400, Math.min(1400, scratchRef.current.vel))
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
    }
  }, [])

  /* ---- cursor tilt: rect cached on enter (no layout reads per move) ---- */
  const rectRef = useRef<DOMRect | null>(null)
  const handlePointerEnter = () => {
    rectRef.current = tiltRef.current?.getBoundingClientRect() ?? null
  }
  const handleTilt = (e: React.PointerEvent) => {
    /* lazily (re)cache the rect: pointerenter can be missed when the boot
       overlay hands the pointer over mid-move — tilt must never go dead */
    let rect = rectRef.current
    if (!rect) {
      rect = tiltRef.current?.getBoundingClientRect() ?? null
      rectRef.current = rect
    }
    if (!rect) return
    tiltTargetRef.current.tx = (e.clientX - rect.left) / rect.width - 0.5
    tiltTargetRef.current.ty = (e.clientY - rect.top) / rect.height - 0.5
  }
  const resetTilt = () => {
    tiltTargetRef.current.tx = 0
    tiltTargetRef.current.ty = 0
    rectRef.current = null
  }

  /* ---- disc scratching ---- */
  const pointerAngle = (e: React.PointerEvent) => {
    const rect = discGroupRef.current!.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
  }
  const onDiscDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort — a synthetic pointer can't be captured */
    }
    scratchRef.current = {
      active: true,
      lastAngle: pointerAngle(e),
      movedAngle: 0,
      vel: 0,
      at: performance.now(),
    }
  }
  const onDiscMove = (e: React.PointerEvent) => {
    if (!scratchRef.current.active) return
    const a = pointerAngle(e)
    let d = a - scratchRef.current.lastAngle
    if (d > 180) d -= 360
    if (d < -180) d += 360
    scratchRef.current.at = performance.now()
    scratchRef.current.lastAngle = a
    scratchRef.current.movedAngle += Math.abs(d)
    /* the seek is the pointer's job alone: the platter keeps its own pace
       (playing state × the speed multiplier) and never follows the finger,
       so scrubbing can no longer fast-forward or jump the rotation */
    onScratch((d / 360) * 3) // one full revolution ≈ 3 seconds
  }
  const onDiscUp = () => {
    /* release hands back nothing: no fling velocity, the disc simply eases
       back to its cruise (or to a stop when the speed setter is at 0) */
    if (scratchRef.current.active) {
      scratchRef.current.active = false
    }
  }
  /* a scratch is not a click: rotating never toggles playback —
     it scrubs, and play/pause state carries through untouched */
  const onDiscClick = () => {
    if (scratchRef.current.movedAngle > 2) return
    onToggle()
  }

  return (
    <div
      ref={tiltRef}
      className="relative select-none"
      style={{ perspective: '1200px', width: '100%', aspectRatio: '1 / 1' }}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handleTilt}
      onPointerLeave={resetTilt}
    >
      <div
        ref={caseRef}
        className="absolute inset-0 will-change-transform"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* ---- glass cartridge body ---- */}
        <div
          className="disc-glass absolute inset-0 rounded-[7%]"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 35%, rgba(160,190,255,0.05) 60%, rgba(255,255,255,0.10) 100%)',
            border: '1px solid rgba(255,255,255,0.28)',
            backdropFilter: frosted ? 'blur(2px)' : undefined,
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(255,255,255,0.12), inset 2px 0 6px rgba(255,255,255,0.06), 0 30px 80px rgba(0,0,0,0.8), 0 0 60px rgba(120,160,255,0.08)',
          }}
        />

        {/* ---- the disc (rotating group) ---- */}
        <div
          ref={discGroupRef}
          className="absolute z-10 will-change-transform"
          style={{
            left: '50%',
            top: '50%',
            translate: '-50% -50%',
            width: '79%',
            height: '79%',
            aspectRatio: '1 / 1',
            transformOrigin: '50% 50%',
          }}
        >
          {/* src is set by the layout effect above, never by React: the swap
              needs the old face cloned before the new one is painted */}
          <img
            ref={discImgRef}
            alt="MiniDisc"
            draggable={false}
            onPointerDown={onDiscDown}
            onPointerMove={onDiscMove}
            onPointerUp={onDiscUp}
            onPointerCancel={onDiscUp}
            onClick={onDiscClick}
            className={`absolute inset-0 h-full w-full cursor-grab rounded-full active:cursor-grabbing${
              hubHole ? ' disc-face' : ''
            }`}
            style={{ boxShadow: '0 10px 50px rgba(0,0,0,0.65), 0 0 40px rgba(140,170,255,0.15)' }}
          />

          {/* ---- hub: the glass clamping ring around a real hole ----
              A cover is a square photo dropped on a round disc; with no hub
              it reads as a cropped picture. `.disc-face` masks the spindle
              hole straight through the artwork (so the wallpaper shows), and
              this ring sits over the edge as the clear polycarbonate collar.
              Lives inside the rotating group, so it stays concentric while
              the disc spins and tilts. Only the track-cover face gets it. */}
          {hubHole && <div className="disc-hub" data-disc-hub="" aria-hidden />}
        </div>

        {/* ---- live iridescence: two rainbow interference bands riding the surface ---- */}
        <div
          ref={sheenARef}
          className="fx-disc pointer-events-none absolute z-[12] rounded-full will-change-transform"
          style={{
            left: '50%',
            top: '50%',
            translate: '-50% -50%',
            width: '79%',
            height: '79%',
            aspectRatio: '1 / 1',
            mixBlendMode: 'screen',
            opacity: 0.55,
            background:
              'conic-gradient(from 0deg, rgba(255,70,150,0.22), rgba(255,200,70,0.16), rgba(90,255,180,0.15), rgba(70,160,255,0.22), rgba(190,90,255,0.18), rgba(255,70,150,0.22))',
            WebkitMaskImage:
              'radial-gradient(circle, transparent 27%, black 37%, black 86%, transparent 97%)',
            maskImage:
              'radial-gradient(circle, transparent 27%, black 37%, black 86%, transparent 97%)',
          }}
        />
        <div
          ref={sheenBRef}
          className="fx-disc pointer-events-none absolute z-[12] rounded-full will-change-transform"
          style={{
            left: '50%',
            top: '50%',
            translate: '-50% -50%',
            width: '79%',
            height: '79%',
            aspectRatio: '1 / 1',
            mixBlendMode: 'screen',
            opacity: 0.4,
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(120,255,220,0.16) 40deg, transparent 95deg, rgba(160,130,255,0.18) 150deg, transparent 200deg, rgba(255,140,200,0.16) 265deg, transparent 320deg)',
            filter: undefined,
            WebkitMaskImage:
              'radial-gradient(circle, transparent 24%, black 40%, black 90%, transparent 99%)',
            maskImage:
              'radial-gradient(circle, transparent 24%, black 40%, black 90%, transparent 99%)',
          }}
        />

        {/* ---- viewing-angle glare: broad light-source highlight on the disc face ---- */}
        <div
          ref={glareRef}
          className="fx-disc pointer-events-none absolute z-[13] rounded-full will-change-transform"
          style={{
            left: '50%',
            top: '50%',
            translate: '-50% -50%',
            width: '79%',
            height: '79%',
            aspectRatio: '1 / 1',
            mixBlendMode: 'screen',
            opacity: 0.9,
            background:
              'linear-gradient(125deg, transparent 30%, rgba(255,130,210,0.10) 42%, rgba(255,255,255,0.24) 50%, rgba(140,210,255,0.12) 58%, transparent 70%)',
            WebkitMaskImage:
              'radial-gradient(circle, transparent 20%, black 34%, black 92%, transparent 100%)',
            maskImage:
              'radial-gradient(circle, transparent 20%, black 34%, black 92%, transparent 100%)',
          }}
        />

        {/* ---- window rim ---- */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: '82%',
            aspectRatio: '1/1',
            border: '2px solid rgba(255,255,255,0.22)',
            boxShadow:
              'inset 0 0 24px rgba(0,0,0,0.55), inset 0 2px 3px rgba(255,255,255,0.25), 0 1px 0 rgba(255,255,255,0.18)',
          }}
        />

        {/* ---- top engraving ---- */}
        <div className="pointer-events-none absolute left-1/2 top-[3.2%] z-30 -translate-x-1/2 text-center">
          <div className="text-[10px] tracking-[0.35em] text-white/70" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            ▲ INSERT THIS END
          </div>
        </div>

        {/* ---- MD watermark ---- */}
        <div
          className="pointer-events-none absolute right-[4%] top-[5%] z-30 leading-none"
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontWeight: 700,
            fontSize: 'clamp(28px, 7vw, 56px)',
            letterSpacing: '-0.02em',
            color: 'transparent',
            WebkitTextStroke: '1px rgba(255,255,255,0.35)',
          }}
        >
          MD
        </div>

        {/* ---- MiniDisc badge ---- */}
        <div
          className="pointer-events-none absolute right-[4%] top-[30%] z-30 rounded-[4px] border border-white/50 px-2 py-1 text-center"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 11, lineHeight: 1.05, color: 'rgba(255,255,255,0.9)' }}>
            Mini
            <br />
            Disc
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 6, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>●●●●</div>
        </div>

        {/* ---- SA coating mark ---- */}
        <div className="pointer-events-none absolute bottom-[9%] left-[6%] z-30 flex items-center gap-2">
          <svg width="34" height="18" viewBox="0 0 34 18" fill="none" className="opacity-80">
            <circle cx="9" cy="9" r="8" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
            <path d="M3 9h3l1.5-4 2 8 1.5-6 1 2h3" stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" fill="none" />
            <path d="M20 9h11" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="2 2" />
          </svg>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 9, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.75)' }}>
            SA COATING
            <br />
            ADVANCE
          </div>
        </div>

        {/* ---- green marble label ---- */}
        <div
          className="pointer-events-none absolute bottom-[7%] right-[5%] z-30 flex items-center justify-center rounded-[6px]"
          style={{
            width: '34%',
            height: '22%',
            background:
              'radial-gradient(ellipse at 30% 20%, rgba(220,255,220,0.55), transparent 55%), radial-gradient(ellipse at 75% 85%, rgba(20,60,30,0.7), transparent 60%), linear-gradient(140deg, #7ba37b 0%, #4c7350 35%, #93b98c 60%, #3c5f42 100%)',
            border: '1px solid rgba(230,255,230,0.5)',
            boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.5), inset 0 -2px 4px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              draggable={false}
              className="h-full w-full rounded-[6px] object-cover"
              style={{ boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.4)' }}
            />
          ) : (
            <span
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 700,
                fontSize: 'clamp(14px, 3.4vw, 26px)',
                letterSpacing: '0.08em',
                color: 'rgba(240,255,240,0.85)',
                textShadow: '0 1px 0 rgba(0,40,10,0.8), 0 -1px 0 rgba(255,255,255,0.35)',
              }}
            >
              MUN15H
            </span>
          )}
        </div>

        {/* ---- corner screws ---- */}
        {[
          'left-[3%] top-[3%]',
          'right-[3%] top-[3%]',
          'left-[3%] bottom-[3%]',
          'right-[3%] bottom-[3%]',
        ].map((pos) => (
          <div
            key={pos}
            className={`pointer-events-none absolute ${pos} z-30 rounded-full`}
            style={{
              width: 12,
              height: 12,
              background: 'radial-gradient(circle at 35% 30%, #e8edf2, #8b939c 55%, #3c4148)',
              boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            <div className="absolute left-1/2 top-1/2 h-[1px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-black/50" />
          </div>
        ))}

        {/* ---- moving glass shine ---- */}
        <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-[7%]">
          <div
            className="animate-shine absolute top-[-60%] h-[220%] w-[28%]"
            style={{
              left: 0,
              background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.14) 45%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.14) 55%, transparent)',
              /* resting state == 0% keyframe: fully off the left edge. When the
                 governor kills animations (`animation: none` at fx tier 2/3),
                 the strip must NOT strand itself over the disc — that was the
                 frozen light band seen during heavy loads / video wallpapers */
              transform: 'translateX(-142.857%) skewX(-12deg)',
            }}
          />
        </div>
      </div>

      {/* ---- chrome tribal armour (two parallax depths) ---- */}
      <img
        src={chromeUrl}
        alt=""
        ref={chromeARef}
        draggable={false}
        className="pointer-events-none absolute z-50 will-change-transform"
        style={{
          inset: '-11%',
          width: '122%',
          height: '122%',
          objectFit: 'fill',
          filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.7))',
        }}
      />
      <img
        src={chromeUrl}
        alt=""
        ref={chromeBRef}
        draggable={false}
        className="pointer-events-none absolute z-0 will-change-transform"
        style={{
          inset: '-16%',
          width: '132%',
          height: '132%',
          objectFit: 'fill',
          transform: 'rotate(180deg)',
          opacity: 0.55,
          filter: "blur(1.5px)",
        }}
      />

    </div>
  )
}
