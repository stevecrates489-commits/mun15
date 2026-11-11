/* The wallpaper themes the player knows about.

   'gradient' used to be a flat preset with its own button. The colour picker
   in the header's top-left now paints a real two-stop gradient, so that
   preset was removed — but old profiles still have "gradient" saved in
   localStorage. Rather than stranding them on a theme that no longer
   exists, that name is MIGRATED to the moving gradient, which is what took
   its place. Both the boot restore and the live theme state read through
   this one function, so the two can never disagree.

   'aurora' — the moving gradient — is still a valid, still-rendered theme,
   but its header button was removed: it can no longer be PICKED. A profile
   that already had it keeps its backdrop. Nothing here changes that: the
   theme id stays in the type, and the migration still points at it. */

export type Theme = 'black' | 'aurora' | 'color' | 'custom'

/** old theme name -> the theme that replaced it */
const MIGRATED: Record<string, Theme> = {
  gradient: 'aurora',
}

/**
 * Read a persisted theme name.
 * Returns null for anything unknown (no saved theme, a typo, a value from a
 * future version) so the caller can fall back to its own default.
 */
export function readSavedTheme(raw: string | null): Theme | null {
  if (raw === 'black' || raw === 'aurora' || raw === 'color' || raw === 'custom') return raw
  if (raw != null && raw in MIGRATED) return MIGRATED[raw]
  return null
}
