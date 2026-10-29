/**
 * Which VoltViz style is behind the player, if any — and how that style is
 * tuned.
 *
 * Remembered beside the player's other display choices: it is a property of
 * the backdrop, not of the deck, so it lives in its own key and survives a
 * reload the same way the visualiser's mode does.
 *
 * The tuning is VoltViz's own settings (its README's URL parameters:
 * sensitivity, speed, hueShift, scale — same ranges, same defaults), but
 * stored PER STYLE: Flame can run slow and dark while Laser Show runs fast
 * and hot, and each visual keeps the tuning it was given.
 */

import { useCallback, useMemo, useState } from 'react'
import type { VisualizerSettings } from './settings'

const KEY = 'md-voltviz'
const SETTINGS_KEY = 'md-voltviz-settings'

/** VoltViz's defaults, per its README. */
export const VOLT_SETTINGS_DEFAULT: VisualizerSettings = {
  sensitivity: 1,
  speed: 1,
  hueShift: 0,
  scale: 1,
}

/** VoltViz's ranges, per its README: 0.1–3, 0.1–3, 0–360, 0.5–3. */
export const VOLT_SETTING_RANGE = {
  sensitivity: { min: 0.1, max: 3, step: 0.1 },
  speed: { min: 0.1, max: 3, step: 0.1 },
  hueShift: { min: 0, max: 360, step: 1 },
  scale: { min: 0.5, max: 3, step: 0.1 },
} as const satisfies Record<keyof VisualizerSettings, { min: number; max: number; step: number }>

type Tuning = Partial<Record<keyof VisualizerSettings, number>>

function clamp(key: keyof VisualizerSettings, value: number): number {
  const { min, max, step } = VOLT_SETTING_RANGE[key]
  const clamped = Math.min(max, Math.max(min, value))
  /* snap to the slider's own steps so a stored value is one the UI can show */
  return Math.round(clamped / step) * step
}

function readTuning(): Record<string, Tuning> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, Tuning> = {}
    for (const [id, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (!values || typeof values !== 'object') continue
      const tuned: Tuning = {}
      for (const key of Object.keys(VOLT_SETTINGS_DEFAULT) as (keyof VisualizerSettings)[]) {
        const v = (values as Record<string, unknown>)[key]
        if (typeof v === 'number' && Number.isFinite(v)) tuned[key] = clamp(key, v)
      }
      if (Object.keys(tuned).length) out[id] = tuned
    }
    return out
  } catch {
    /* private mode — every visual keeps VoltViz's defaults this session */
    return {}
  }
}

function stored(): string | null {
  try {
    const found = localStorage.getItem(KEY)
    return found && found !== 'off' ? found : null
  } catch {
    /* private mode — the backdrop is simply off for this session */
    return null
  }
}

export function useVoltViz() {
  const [style, setStyleState] = useState<string | null>(stored)
  const [tuning, setTuning] = useState<Record<string, Tuning>>(readTuning)

  /* the selected visual's own values; a visual that has never been tuned
     shows VoltViz's defaults */
  const settings = useMemo<VisualizerSettings>(
    () => ({ ...VOLT_SETTINGS_DEFAULT, ...(style ? tuning[style] : undefined) }),
    [tuning, style],
  )

  const setStyle = useCallback((next: string | null) => {
    setStyleState(next)
    try {
      localStorage.setItem(KEY, next ?? 'off')
    } catch {
      /* private mode — the choice lasts for this session */
    }
  }, [])

  const setSetting = useCallback(
    (key: keyof VisualizerSettings, value: number) => {
      if (!style) return
      const clamped = clamp(key, value)
      setTuning((prev) => {
        const next = { ...prev, [style]: { ...prev[style], [key]: clamped } }
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
        } catch {
          /* private mode — the tuning lasts for this session */
        }
        return next
      })
    },
    [style],
  )

  return { style, setStyle, settings, setSetting }
}
