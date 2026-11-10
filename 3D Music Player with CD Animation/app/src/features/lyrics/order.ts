/**
 * The order the providers are asked in.
 *
 * The waterfall has a default — the one the providers are ranked by, from
 * the most precisely timed to the plainest — but the order belongs to the
 * person using the player. They can put a provider they trust first, put a
 * slow one last, or take a provider out of the running entirely, and the
 * order survives a restart.
 *
 * It lives in localStorage because it is a preference about how the player
 * behaves, not a piece of a song: it is the same for every track.
 */

const STORAGE_KEY = 'md-lyrics-provider-order'

/**
 * The order the providers are asked in, as the waterfall ranks them.
 *
 * Tier 1 is timed to the word, tier 2 to the line, tier 3 is plain text.
 * The tiers are not decoration: they are why one provider is asked before
 * another, and the settings panel shows them so the order can be read.
 */
export const DEFAULT_PROVIDER_ORDER = [
  /* Tier 1 — word and syllable timing */
  'unison',
  'betterlyrics',
  'betterlyrics-qq',
  'netease',
  'paxsenix-word',
  'kugou',
  'lyricsplus',
  /* Tier 2 — line timing */
  'lrclib',
  'paxsenix-line',
  'lrc-red',
  /* Tier 3 — plain text */
  'lyrics-ovh',
] as const

/** the ids the settings panel knows about, in the default order */
export function defaultProviderOrder(): string[] {
  return [...DEFAULT_PROVIDER_ORDER]
}

/**
 * The order in force right now.
 *
 * A stored order that has fallen out of step with the providers (one was
 * added, one was renamed) is repaired rather than trusted: the ids that are
 * still known keep their places, the ones that are new are put where the
 * DEFAULT order ranks them — after the last kept id that in the default
 * comes before them — and the ones that are gone are dropped.
 */
export function readProviderOrder(known: readonly string[]): string[] {
  let stored: string[] = []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        stored = parsed.filter((id): id is string => typeof id === 'string')
      }
    }
  } catch {
    /* private mode, or a corrupted value — the default is fine */
  }
  if (!stored.length) return defaultProviderOrder()

  const kept = stored.filter((id) => known.includes(id))
  const missing = known.filter((id) => !kept.includes(id))

  /* A NEW provider takes the place the default order gives it, not the end
     of the list: appended blindly, a new tier-1 word-timed provider would
     sit AFTER the plain-text ones and never be asked first. It goes in
     after the last kept id that the default order ranks before it. */
  const fallback = (id: string) => DEFAULT_PROVIDER_ORDER.indexOf(id as (typeof DEFAULT_PROVIDER_ORDER)[number])
  const rebuilt: string[] =StoredOrder(kept, missing, fallback)
  return rebuilt
}

/** fold the missing ids into the kept ones, at their default-order places */
function StoredOrder(
  kept: string[],
  missing: string[],
  fallback: (id: string) => number,
): string[] {
  const out = [...kept]
  for (const id of missing) {
    const rank = fallback(id)
    /* where the id belongs, in default order, among what is already there */
    let insertAt = out.length
    for (let i = 0; i < out.length; i += 1) {
      if (fallback(out[i]) > rank) {
        insertAt = i
        break
      }
    }
    out.splice(insertAt, 0, id)
  }
  return out
}

/** write the order down */
export function writeProviderOrder(order: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    /* private mode — the order lasts for this session only */
  }
}

/** put the order back the way the waterfall has it */
export function resetProviderOrder(): string[] {
  const order = defaultProviderOrder()
  writeProviderOrder(order)
  return order
}

/**
 * Has the order ever been changed from the default?
 *
 * The comparison is against the default as it applies to the providers THIS
 * build knows: a provider added since the default was written is not a
 * change the person made, so it must not make the list look edited.
 */
export function providerOrderIsCustom(
  order: readonly string[],
  known: readonly string[],
): boolean {
  const fallback = defaultProviderOrder().filter((id) => known.includes(id))
  if (order.length !== fallback.length) return true
  return order.some((id, i) => id !== fallback[i])
}
