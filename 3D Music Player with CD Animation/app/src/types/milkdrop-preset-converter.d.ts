/* milkdrop-preset-converter ships a single UMD bundle with no types. */
declare module 'milkdrop-preset-converter' {
  export function convertPreset(
    text: string,
  ): Promise<Record<string, unknown> & { presetParts?: unknown }>
  export function convertShader(hlsl: string): Promise<string>
  export function convertPresetEquations(...args: unknown[]): Promise<unknown>
  export function convertWaveEquations(...args: unknown[]): Promise<unknown>
  export function convertShapeEquations(...args: unknown[]): Promise<unknown>
}
