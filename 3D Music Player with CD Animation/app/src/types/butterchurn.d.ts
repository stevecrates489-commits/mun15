/**
 * Butterchurn (MilkDrop in WebGL) and its preset packs ship no types. These
 * declarations are only the surface this app touches — the visualizer module
 * owns everything else.
 */
declare module 'butterchurn' {
  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void
    disconnectAudio(node: AudioNode): void
    loadPreset(preset: object, blendTime?: number): void
    setRendererSize(
      width: number,
      height: number,
      opts?: { pixelRatio?: number; textureRatio?: number },
    ): void
    render(opts?: { elapsedTime?: number }): void
    dispose?(): void
  }

  const butterchurn: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number },
    ): ButterchurnVisualizer
  }

  export default butterchurn
}

declare module 'butterchurn-presets' {
  const presets: Record<string, object>
  export default presets
}
