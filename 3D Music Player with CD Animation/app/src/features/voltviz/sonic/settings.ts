/**
 * Persisted per-visualizer settings for the two Sonic Topography ports.
 *
 * The shared VoltViz tuning (sensitivity/speed/scale) already lives per style
 * under `md-voltviz-settings`; everything the ports bring on top — the theme,
 * the ripples/meteors/idle-wave/auto-rotate/peak toggles, the channel
 * intensities, the camera — is its own JSON record under a per-visualizer key,
 * so the two ports never share state. The settings card (each impl file's
 * `Overlay`) writes through its visualizer's `api`; a fresh mount reads the
 * same record so the tuning survives switching styles.
 */

export function loadSonicSettings<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out = { ...defaults } as Record<string, unknown>
    for (const [k, d] of Object.entries(defaults)) {
      const v = parsed[k]
      if (v !== null && typeof v === typeof d) out[k] = v
    }
    return out as T
  } catch {
    /* private mode — the defaults last for this session */
    return { ...defaults }
  }
}

export function saveSonicSettings(key: string, values: object) {
  try {
    localStorage.setItem(key, JSON.stringify(values))
  } catch {
    /* private mode — the tuning lasts for this session */
  }
}
