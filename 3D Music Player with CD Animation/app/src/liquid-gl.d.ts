/* liquid-gl@3 ships JS only (no types field) — declarations for the exact
   surface this app uses: the default factory, its static refresh helper,
   and the lens handle it returns. Keep in sync with node_modules/liquid-gl. */
declare module 'liquid-gl' {
  export interface LiquidGLHandle {
    destroy(): void
    setTint(color: string): void
  }

  interface LiquidGLOptions {
    engine?: 'auto' | 'webgpu' | 'webgl2' | 'webgl'
    snapshot?: string
    target?: string
    resolution?: number
    zIndex?: number
    refraction?: number
    aberration?: number
    bevelDepth?: number
    bevelWidth?: number
    frost?: number
    shadow?: boolean
    specular?: boolean
    reveal?: 'none' | 'fade'
    tilt?: boolean
    tiltFactor?: number
    tiltEase?: number
    draggable?: boolean
    interaction?: 'none' | 'fluid'
    magnify?: number
    tint?: string | null
    helper?: boolean
    on?: { init?: (lens: LiquidGLHandle) => void }
  }

  interface LiquidGLStatic {
    (
      target: string,
      options?: LiquidGLOptions,
    ): LiquidGLHandle | LiquidGLHandle[] | undefined
    /* calling this with an already-registered element still re-captures the
       page snapshot — the app's only public "refresh the glass" lever */
    registerDynamic(elements: string | Element | ArrayLike<Element>): void
    syncWith(): unknown
  }

  const liquidGL: LiquidGLStatic
  export default liquidGL
}
