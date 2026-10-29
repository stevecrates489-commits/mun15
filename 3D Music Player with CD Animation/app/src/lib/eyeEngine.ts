import * as THREE from 'three'

export interface EyeEngine {
  canvas: HTMLCanvasElement
  setActive: (active: boolean) => void
}

let engine: EyeEngine | null = null
let building: Promise<EyeEngine> | null = null

/** yields to the UI between heavy build steps so boot never freezes */
const idle = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * Builds (once) and caches the three-pupil eye. The first call starts an
 * async, chunked build — call early (page boot) so CREATOR opens instantly.
 * The returned canvas can be moved between DOM parents freely; the WebGL
 * context survives. setActive(false) stops the render loop while hidden.
 * Defaults, as designed: 3 pupils · Round · Curious · shape-shift on.
 */
export function ensureEyeEngine(): Promise<EyeEngine> {
  if (engine) return Promise.resolve(engine)
  if (!building) building = build()
  return building
}

async function build(): Promise<EyeEngine> {
  const canvas = document.createElement('canvas')
  const SIZE = 100
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputEncoding = THREE.sRGBEncoding
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50)
  camera.position.set(0, 0, 6.3)

  await idle()

  /* soft studio environment for wet reflections */
  function envTex() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d')!
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#5a5360'); gr.addColorStop(.5, '#2a2428'); gr.addColorStop(1, '#120f11')
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 512)
    g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 30
    g.fillRect(180, 120, 150, 110); g.fillRect(640, 90, 220, 60); g.fillStyle = '#ffd9c0'; g.fillRect(420, 300, 120, 40)
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding
    const p = new THREE.PMREMGenerator(renderer); const e = p.fromEquirectangular(t).texture; t.dispose(); p.dispose(); return e
  }
  scene.environment = envTex()
  scene.add(new THREE.HemisphereLight(0xffeee8, 0x201015, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 4, 6); scene.add(key)
  const rim = new THREE.DirectionalLight(0xff7a8a, 0.8); rim.position.set(5, -2, -3); scene.add(rim)

  await idle()

  /* sclera: pale, veins entering from the back (baked once) */
  function scleraTex() {
    const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!
    g.fillStyle = '#f0e8e5'; g.fillRect(0, 0, W, H)
    for (let i = 0; i < 350; i++) { g.fillStyle = `rgba(190,150,150,${Math.random() * .035})`; g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 10 + Math.random() * 30, 0, 7); g.fill() }
    for (const [x0, x1] of [[0, .4 * W], [W, .6 * W]]) {
      const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, 'rgba(200,110,115,.38)'); gr.addColorStop(1, 'rgba(200,110,115,0)')
      g.fillStyle = gr; g.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H)
    }
    g.lineCap = 'round'
    const fade = (y: number) => Math.max(0, 1 - Math.pow(Math.abs(y / H - .5) * 2, 3))
    function vein(x: number, y: number, a: number, dir: number, steps: number, w: number, depth: number, am: number) {
      let turn = 0
      for (let i = 0; i < steps; i++) {
        turn = turn * .9 + (Math.random() - .5) * .14
        a += turn + Math.atan2(Math.sin(dir - a), Math.cos(dir - a)) * .025
        const nx = x + Math.cos(a) * 1.5, ny = y + Math.sin(a) * 1.5, p = i / steps
        g.strokeStyle = `rgba(${135 + Math.random() * 30 | 0},${28 + Math.random() * 18 | 0},${42 + Math.random() * 18 | 0},${(.6 - .4 * p) * fade(ny) * am})`
        g.lineWidth = Math.max(.4, w * (1 - p * .7)); g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke()
        x = nx; y = ny
        if (depth < 3 && Math.random() < .04 * (1 + p)) vein(x, y, a + (Math.random() < .5 ? -1 : 1) * (.3 + Math.random() * .4), dir, steps * .45 * (1 - p) + 4, w * .65, depth + 1, am)
      }
    }
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
    for (const [x0, dir] of [[0, 0], [W, Math.PI]]) {
      for (let i = 0; i < 15; i++) vein(Math.abs(x0 - Math.random() * 20), H * (.5 + gauss() * .3), dir + (Math.random() - .5) * .7, dir, 85 + Math.random() * 55, 1.6, 0, 1)
      for (let i = 0; i < 110; i++) { const x = Math.abs(x0 - (.2 + Math.random() * .15) * W); vein(x, H * (.5 + gauss() * .3), dir + (Math.random() - .5) * 1.2, dir, 5 + Math.random() * 8, .45, 3, .45) }
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t
  }

  await idle()

  /* iris: blue-grey fibres, tan zone, dark navy edge (baked once) */
  function irisTex() {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!, m = S / 2
    const gr = g.createRadialGradient(m, m, 0, m, m, m)
    ;[[0, '#7d7968'], [.2, '#a3a291'], [.34, '#9db4c4'], [.6, '#6f9bc0'], [.82, '#3f6f9e'], [.95, '#1c3d66'], [1, '#071428']].forEach(([o, col]) => gr.addColorStop(o as number, col as string))
    g.fillStyle = gr; g.fillRect(0, 0, S, S)
    const fib = (n: number, col: (r: number) => string, wmin: number, wmax: number, r0min: number, r0max: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, r0 = m * (r0min + Math.random() * (r0max - r0min)), r1 = r0 + m * (.15 + Math.random() * .45), w = a + (Math.random() - .5) * .05
        g.strokeStyle = col(Math.random()); g.lineWidth = wmin + Math.random() * (wmax - wmin)
        g.beginPath(); g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0); g.quadraticCurveTo(m + Math.cos(w) * (r0 + r1) / 2, m + Math.sin(w) * (r0 + r1) / 2, m + Math.cos(w) * Math.min(r1, m * .97), m + Math.sin(w) * Math.min(r1, m * .97)); g.stroke()
      }
    }
    fib(1300, r => `rgba(10,30,60,${.1 + r * .35})`, .3, 1, .2, .8)
    fib(2100, r => `rgba(225,240,255,${.08 + r * .4})`, .25, .8, .18, .85)
    fib(450, r => `rgba(235,225,200,${.1 + r * .3})`, .3, .7, .15, .45)
    for (let i = 0; i < 35; i++) { const a = Math.random() * 6.283, r = m * (.3 + Math.random() * .12); g.fillStyle = 'rgba(30,40,55,.25)'; g.beginPath(); g.ellipse(m + Math.cos(a) * r, m + Math.sin(a) * r, 1.5 + Math.random() * 2.5, 3 + Math.random() * 4, a, 0, 7); g.fill() }
    const f = g.createRadialGradient(m, m, m * .8, m, m, m); f.addColorStop(0, 'rgba(2,8,20,0)'); f.addColorStop(1, 'rgba(2,8,20,.85)'); g.fillStyle = f; g.fillRect(0, 0, S, S)
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t
  }

  const R = 1.6, IR = 0.32, PR = 0.105
  const eye = new THREE.Group(); scene.add(eye)
  const sclera = new THREE.Mesh(
    new THREE.SphereGeometry(R, 64, 48),
    new THREE.MeshPhysicalMaterial({ map: scleraTex(), roughness: .42, clearcoat: .7, clearcoatRoughness: .15, envMapIntensity: .9 }),
  )
  sclera.rotation.y = -Math.PI / 2
  eye.add(sclera)

  await idle()

  const iAng = Math.asin(IR / R)
  const irisGeo = new THREE.SphereGeometry(R + .006, 48, 16, 0, Math.PI * 2, 0, iAng); irisGeo.rotateX(Math.PI / 2)
  {
    const p = irisGeo.attributes.position, uv = irisGeo.attributes.uv, v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, .5 + p.getX(i) / (2 * IR), .5 + p.getY(i) / (2 * IR))
      v.fromBufferAttribute(p as THREE.BufferAttribute, i); const th = Math.acos(Math.min(1, v.z / (R + .006))), f = Math.max(0, 1 - (th / iAng) ** 2); v.setLength(R + .006 + .022 * f); p.setXYZ(i, v.x, v.y, v.z)
    }
  }
  irisGeo.computeVertexNormals()
  const shGeo = new THREE.SphereGeometry(R + .003, 32, 12, 0, Math.PI * 2, 0, Math.asin(IR * 1.4 / R)); shGeo.rotateX(Math.PI / 2)
  {
    const p = shGeo.attributes.position, uv = shGeo.attributes.uv
    for (let i = 0; i < p.count; i++) uv.setXY(i, .5 + p.getX(i) / (2 * IR * 1.4), .5 + p.getY(i) / (2 * IR * 1.4))
  }
  const shTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    gr.addColorStop(0, 'rgba(50,15,20,.6)'); gr.addColorStop(.7, 'rgba(50,15,20,.55)'); gr.addColorStop(1, 'rgba(50,15,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c)
  })()
  const iTex = irisTex()
  const cb = IR * 1.08, ch = .11, cz0 = Math.sqrt(R * R - cb * cb), crd = (cb * cb + ch * ch) / (2 * ch), cang = Math.asin(cb / crd)
  const corGeo = new THREE.SphereGeometry(crd, 32, 12, 0, Math.PI * 2, 0, cang); corGeo.rotateX(Math.PI / 2); corGeo.translate(0, 0, cz0 + ch - crd)
  const hz = cz0 + ch - crd + Math.sqrt(crd * crd - .0221) + .004
  const hiGeo = new THREE.CircleGeometry(.04, 16), hiGeo2 = new THREE.CircleGeometry(.075, 16)

  /* pupil shapes */
  const shapes: Record<string, () => number[][]> = {
    Round: () => Array.from({ length: 48 }, (_, i) => { const a = i / 48 * 6.283; return [Math.cos(a), Math.sin(a)] }),
    Star: () => Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .5 : 1.2; return [Math.cos(a) * r, Math.sin(a) * r] }),
    Heart: () => Array.from({ length: 64 }, (_, i) => { const t = i / 64 * 6.283; return [16 * Math.pow(Math.sin(t), 3) / 15, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) / 15] }),
    Slit: () => Array.from({ length: 48 }, (_, i) => { const a = i / 48 * 6.283; return [Math.cos(a) * .38, Math.sin(a) * 1.35] }),
    Diamond: () => [[0, 1.3], [.85, 0], [0, -1.3], [-.85, 0]],
  }
  const names = Object.keys(shapes)
  const NR = 64
  function radial(pts: number[][]) {
    const out = new Float32Array(NR)
    for (let k = 0; k < NR; k++) {
      const a = k / NR * 6.2832, dx = Math.cos(a), dy = Math.sin(a); let best = 1e9
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex
        if (Math.abs(den) < 1e-9) continue; const t = (p[0] * ey - p[1] * ex) / den, u = (p[0] * dy - p[1] * dx) / den
        if (t > 0 && u >= 0 && u <= 1 && t < best) best = t
      }
      out[k] = best * PR
    }
    return out
  }
  const radials: Record<string, Float32Array> = {}
  names.forEach(n => (radials[n] = radial(shapes[n]())))
  function makeFan() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NR + 1) * 3), 3))
    const idx: number[] = []
    for (let k = 0; k < NR; k++) idx.push(0, 1 + k, 1 + (k + 1) % NR)
    g.setIndex(idx)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1)
    return g
  }
  function fanUpdate(g: THREE.BufferGeometry, rad: Float32Array) {
    const p = g.attributes.position.array as Float32Array
    for (let k = 0; k < NR; k++) { const a = k / NR * 6.2832; p[3 + k * 3] = Math.cos(a) * rad[k]; p[4 + k * 3] = Math.sin(a) * rad[k] }
    g.attributes.position.needsUpdate = true
  }
  const shapeName: string = 'Round', count = 3, shapeShift = true
  const nameFor = (i: number) => (shapeName === 'Mixed' ? names[i % names.length] : shapeName)

  const layouts: Record<number, number[][]> = { 3: [[0, .4], [-.4, -.22], [.4, -.22]] }
  const wander: Record<number, number> = { 3: .09 }
  let irises: {
    grp: THREE.Group; pg: THREE.Group; pupil: THREE.Mesh; tex: THREE.Texture
    sn: string; rad: Float32Array; home: number[]; home2: number[]; grow: number
    cur: number[]; tgt: number[]; timer: number; size: number; ph: number
  }[] = []
  function makeIris(h: number[], i: number) {
    const grp = new THREE.Group(); eye.add(grp)
    const tex = iTex.clone(); tex.needsUpdate = true
    const iris = new THREE.Mesh(irisGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: .5 }))
    const pg = new THREE.Group(); pg.position.z = R + .04
    const pupil = new THREE.Mesh(makeFan(), new THREE.MeshBasicMaterial({ color: 0x010203 }))
    const halo = new THREE.Mesh(pupil.geometry as THREE.BufferGeometry, new THREE.MeshBasicMaterial({ color: 0x020a18, transparent: true, opacity: .45, depthWrite: false }))
    halo.scale.set(1.22, 1.22, 1); halo.position.z = -.002
    pg.add(halo, pupil)
    const cornea = new THREE.Mesh(corGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .14, roughness: 0, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2, depthWrite: false }))
    const hl = new THREE.Group(); hl.position.set(-.1, .11, hz)
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, depthWrite: false, toneMapped: false })
    const wm2 = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: .18, depthWrite: false, toneMapped: false })
    hl.add(new THREE.Mesh(hiGeo, wm), new THREE.Mesh(hiGeo2, wm2))
    grp.add(new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })), iris, pg, cornea, hl)
    return { grp, pg, pupil, tex, sn: nameFor(i), rad: Float32Array.from(radials[nameFor(i)]), home: h.slice(), home2: h.slice(), grow: 1, cur: [0, 0], tgt: [0, 0], timer: Math.random() * 1.2, size: .9, ph: i * 2.1 }
  }
  const _v = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1)
  function place(o: (typeof irises)[number]) {
    const t = o.home[0] + o.cur[0], p = o.home[1] + o.cur[1]
    _v.set(Math.sin(t) * Math.cos(p), Math.sin(p), Math.cos(t) * Math.cos(p)).normalize()
    o.grp.quaternion.setFromUnitVectors(_z, _v)
  }
  irises = layouts[count].map((h, i) => makeIris(h, i))

  /* drag-rotate the eyeball like a 3D object — clamped to ~155 degrees
     total so it never spins a full circle. Eases back home on release. */
  const ROT = 1.35
  let drag = false, lx = 0, ly = 0, rotX = 0, rotY = 0
  const onDown = (e: PointerEvent) => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing' }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    rotY += (e.clientX - lx) * .008; rotX += (e.clientY - ly) * .008; lx = e.clientX; ly = e.clientY
    rotY = Math.max(-ROT, Math.min(ROT, rotY)); rotX = Math.max(-ROT, Math.min(ROT, rotX))
  }
  const up = () => { drag = false; canvas.style.cursor = 'grab' }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.style.cursor = 'grab'
  renderer.setSize(SIZE, SIZE, false)

  const clock = new THREE.Clock()
  let T = 0
  let raf = 0
  let active = false
  const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt)
  const M = { iv: [.35, 1.2] as [number, number], amp: 1, sync: .3, k: 11, rot: 1, bias: 0, pulse: 0, pf: 0, po: 0 } /* Curious */
  function onShapeMove(o: (typeof irises)[number]) {
    if (!shapeShift) return
    const c = names.filter(n => n !== o.sn)
    o.sn = c[Math.random() * c.length | 0]
  }
  function loopGaze(dt: number) {
    const A = wander[count] * M.amp
    irises.forEach(o => {
      o.timer -= dt
      if (o.timer <= 0) {
        o.timer = M.iv[0] + Math.random() * (M.iv[1] - M.iv[0])
        const r = () => (Math.random() * 2 - 1) * A
        if (Math.random() < M.sync) { const s = [r(), r()]; irises.forEach(q => { q.tgt = s.slice(); q.timer = o.timer; onShapeMove(q) }) }
        else { o.tgt = [r(), r()]; onShapeMove(o) }
      }
    })
  }
  function loop() {
    if (!active) return
    const dt = Math.min(clock.getDelta(), .05); T += dt
    loopGaze(dt)
    irises.forEach(o => {
      o.home[0] += (o.home2[0] - o.home[0]) * damp(3, dt); o.home[1] += (o.home2[1] - o.home[1]) * damp(3, dt)
      o.grow += (1 - o.grow) * damp(4, dt); const g = Math.max(o.grow, .001); o.grp.scale.set(g, g, 1)
      const k = damp(M.k, dt)
      o.cur[0] += (o.tgt[0] - o.cur[0]) * k; o.cur[1] += (o.tgt[1] - o.cur[1]) * k
      const hip = .03 * Math.sin(T * 3.1 + o.ph) + .02 * Math.sin(T * 5.3 + o.ph * 2)
      const sT = 1.04 + hip
      o.size += (sT - o.size) * damp(sT < o.size ? 9 : 1.8, dt)
      o.pg.scale.set(o.size, o.size, 1)
      const r = Math.min(1, .9 + .1 * (o.size - .52) / .5); (o.tex as THREE.Texture & { repeat: THREE.Vector2; offset: THREE.Vector2 }).repeat.set(r, r); (o.tex as THREE.Texture & { repeat: THREE.Vector2; offset: THREE.Vector2 }).offset.set(.5 - .5 * r, .5 - .5 * r)
      { const tr = radials[o.sn], kk = damp(9, dt); for (let k = 0; k < NR; k++) o.rad[k] += (tr[k] - o.rad[k]) * kk; fanUpdate(o.pupil.geometry as THREE.BufferGeometry, o.rad) }
      place(o)
    })
    /* released drag eases the eyeball back home */
    if (!drag) { rotX += (0 - rotX) * damp(1.5, dt); rotY += (0 - rotY) * damp(1.5, dt) }
    eye.rotation.y = (Math.sin(T * .45) * .32 + Math.sin(T * 1.1) * .05) * M.rot + rotY
    eye.rotation.x = (Math.sin(T * .33 + 1) * .2 + Math.sin(T * .9) * .04) * M.rot + rotX
    eye.rotation.z = Math.sin(T * .27) * .05
    eye.position.y = Math.sin(T * .8) * .06
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  function setActive(a: boolean) {
    if (a === active) return
    active = a
    if (a) {
      clock.getDelta() /* swallow the pause */
      raf = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(raf)
    }
  }

  engine = { canvas, setActive }
  return engine
}
