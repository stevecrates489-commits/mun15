/**
 * The providers, and the tiers they sit in.
 *
 * This is the map the settings panel draws and the chain walks. Every
 * provider answers on its own; the order they are asked in is the person's
 * to set, and this file only says what each one IS.
 *
 * The tiers are the reason one provider is asked before another:
 *
 *   Tier 1 — timed to the word or the syllable. The words arrive exactly
 *             when they are sung.
 *   Tier 2 — timed to the line. The line arrives when it starts; the words
 *             inside it are interpolated across it.
 *   Tier 3 — plain text. The words are there; where they fall is not.
 *
 * A provider marked unavailable is one this build cannot reach: its site
 * answers a browser with a challenge rather than a lyric, and the community
 * answer to that is not to scrape it. It is listed, with its place in the
 * waterfall, so the map is whole — but it is not asked.
 */

import {
  artistCandidates,
  fetchBetterLyrics,
  fetchBetterLyricsQq,
  fetchKpoe,
  fetchKuGou,
  fetchLrclib,
  fetchLrcRed,
  fetchLyricsOvh,
  fetchNetEase,
  fetchUnison,
  KPOE_SOURCE_ORDERS,
  titleCandidates,
  type ProviderPayload,
  type TrackQuery,
} from './providers.ts'

/* The fetchers for the whole waterfall live in providers.ts. Every row in
   the list below names the one that serves it. The list carries only
   providers this build can REACH: the dead routes (QQ's refused hosts,
   Genius' edge-blocked API, AZLyrics' challenge wall, Musixmatch's
   scrambled anonymous tier, YouTube's dead caption front-ends) were probed
   and REMOVED in round 5 — their findings are recorded in
   AGENT-HANDOFF.md §5 item 42, not re-tried here. */

/** which tier a provider belongs to */
export type ProviderTier = 1 | 2 | 3

/** one provider, as the settings panel and the chain know it */
export interface ProviderDef {
  id: string
  /** the name, as it should be read */
  label: string
  /** the name, as it fits in a narrow list */
  short: string
  tier: ProviderTier
  /** what this one is, in a line */
  note: string
  /** can this build reach it? */
  available: boolean
  /** why this build cannot reach it — shown when the row is hovered */
  unavailableReason?: string
  /** ask it for this track — null when it is unavailable */
  fetch: (query: TrackQuery, signal?: AbortSignal) => Promise<ProviderPayload | null>
}

/** the shape every provider's fetch takes */
type Fetcher = (
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
) => Promise<ProviderPayload | null>

/** wrap a fetcher so it gets the title and artist candidates it needs */
const withCandidates = (fn: Fetcher) => (query: TrackQuery, signal?: AbortSignal) =>
  fn(query, titlesFor(query), artistCandidates(query.artist), signal)

/**
 * The titles worth asking with — the file's own, and the ones inside it.
 *
 * A file named `Daft Punk - One More Time` with the artist left blank puts
 * the artist IN the title, and no provider knows a title like that. The
 * artist is known here, so the part before the dash is taken off and the
 * song is asked for on its own.
 */
function titlesFor(query: TrackQuery): string[] {
  const titles = titleCandidates(query.title)
  const artist = query.artist.trim()
  if (!artist) return titles
  const prefix = new RegExp(`^\\s*${escapeForRegExp(artist)}\\s*[-–—]\\s*`, 'i')
  const stripped = query.title.replace(prefix, '').trim()
  if (stripped && !titles.includes(stripped)) titles.push(stripped)
  return titles
}

/** a literal string, safe to put inside a regular expression */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * How long the WHOLE chain gets before it takes what has arrived.
 *
 * Every provider carries its own budget (see `providers.ts`); this is the
 * backstop above them all, so a track change waits no longer than this
 * however many providers are in the order.
 */
const CHAIN_DEADLINE_MS = 8_000

export const PROVIDERS: ProviderDef[] = [
  /* ---- Tier 1: word and syllable timing ---- */
  {
    id: 'unison',
    label: 'Unison',
    short: 'UNISON',
    tier: 1,
    note: 'Apple Music syllable timing, as TTML',
    available: true,
    fetch: withCandidates(fetchUnison),
  },
  {
    id: 'betterlyrics',
    label: 'BetterLyrics · Apple TTML',
    short: 'BLYRICS',
    tier: 1,
    note: 'Word-level Apple TTML by exact title + artist + length',
    available: true,
    fetch: withCandidates(fetchBetterLyrics),
  },
  {
    id: 'betterlyrics-qq',
    label: 'BetterLyrics · QQ QRC',
    short: 'BQQ',
    tier: 1,
    note: 'QQ karaoke timing through the BetterLyrics cache',
    available: true,
    fetch: withCandidates(fetchBetterLyricsQq),
  },
  {
    id: 'netease',
    label: 'NetEase Cloud Music',
    short: 'NETEASE',
    tier: 1,
    note: 'Largest open catalogue, millisecond timing',
    available: true,
    fetch: withCandidates(fetchNetEase),
  },
  {
    id: 'paxsenix-word',
    label: 'PaxSenix · Musixmatch / Spotify',
    short: 'PAXSENIX',
    tier: 1,
    note: 'Word offsets through the LyricsPlus gateway',
    available: true,
    fetch: withCandidates((q, t, a, s) =>
      fetchKpoe(q, t, a, KPOE_SOURCE_ORDERS['paxsenix-word'], 'PaxSenix · Musixmatch', s),
    ),
  },
  {
    id: 'kugou',
    label: 'KuGou Music',
    short: 'KUGOU',
    tier: 1,
    note: 'Mobile karaoke format, wide reach',
    available: true,
    fetch: withCandidates(fetchKuGou),
  },
  {
    id: 'lyricsplus',
    label: 'LyricsPlus',
    short: 'LYRICSPLUS',
    tier: 1,
    note: 'Aggregated Apple / Spotify word cache',
    available: true,
    fetch: withCandidates((q, t, a, s) =>
      fetchKpoe(q, t, a, KPOE_SOURCE_ORDERS.lyricsplus, 'LyricsPlus', s),
    ),
  },

  /* ---- Tier 2: line timing ---- */
  {
    id: 'lrclib',
    label: 'LRCLIB',
    short: 'LRCLIB',
    tier: 2,
    note: 'Open REST API, the fastest and cleanest',
    available: true,
    fetch: withCandidates(fetchLrclib),
  },
  {
    id: 'paxsenix-line',
    label: 'PaxSenix · Spotify',
    short: 'PAXSENIX L',
    tier: 2,
    note: 'Line-level scrape of official releases',
    available: true,
    fetch: withCandidates((q, t, a, s) =>
      fetchKpoe(q, t, a, KPOE_SOURCE_ORDERS['paxsenix-line'], 'PaxSenix · Spotify', s),
    ),
  },
  {
    id: 'lrc-red',
    label: 'Megalobiz · lrc.red',
    short: 'LRC.RED',
    tier: 2,
    note: 'Community archive of timed lyrics',
    available: true,
    fetch: withCandidates(fetchLrcRed),
  },

  /* ---- Tier 3: plain text ---- */
  {
    id: 'lyrics-ovh',
    label: 'Lyrics.ovh',
    short: 'LYRICS.OVH',
    tier: 3,
    note: 'Zero-key public API, plain text',
    available: true,
    fetch: withCandidates(fetchLyricsOvh),
  },
]

/** every provider's id, in the order they are listed */
export const PROVIDER_IDS: string[] = PROVIDERS.map((p) => p.id)

/** the provider with this id */
export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** the tier names, for the panel */
export const TIER_NAMES: Record<ProviderTier, string> = {
  1: 'WORD / SYLLABLE',
  2: 'LINE',
  3: 'PLAIN TEXT',
}

/** the tier names, short enough for a badge */
export const TIER_SHORT: Record<ProviderTier, string> = {
  1: 'T1',
  2: 'T2',
  3: 'T3',
}

/**
 * Ask one provider for this track.
 *
 * A provider that is down, slow or does not have the song answers with
 * nothing — it never throws at the caller, so a dead service cannot cost
 * the player a lyric.
 */
export async function fetchProvider(
  id: string,
  query: TrackQuery,
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const provider = providerById(id)
  if (!provider || !provider.available) return null
  try {
    return await provider.fetch(query, signal)
  } catch {
    return null
  }
}

/**
 * Ask the providers for this track, and take the first one that has it.
 *
 * The providers are asked AT ONCE. Asking them one after another meant a
 * track waited out the dead ones in turn — Unison's 404, then NetEase, then
 * QQ's eleven-second refusal — before the answer arrived. In parallel every
 * provider is already working while the first answer is still on its way.
 *
 * The ORDER still decides the winner — but it no longer waits for the
 * SLOWEST provider. The answers used to be collected with `Promise.all`,
 * which holds the whole chain until every straggler is done; now the
 * promises are awaited IN the order the person set, and the chain returns
 * the moment the first one IN THAT ORDER has a song. The losers are
 * aborted on the way out, so nothing keeps running for nothing.
 *
 * A deadline is the backstop: if nothing has been settled by it, the best
 * payload that has arrived takes the win rather than nobody's.
 */
export async function runProviderChain(
  query: TrackQuery,
  order: string[],
  signal?: AbortSignal,
): Promise<{ id: string; payload: ProviderPayload } | null> {
  const wanted = order.filter((id) => providerById(id)?.available)
  if (!wanted.length) return null

  /* one controller per provider, so the losers can be stopped on their own */
  const controllers = new Map<string, AbortController>()
  const running = wanted.map((id) => {
    const controller = new AbortController()
    controllers.set(id, controller)
    return fetchProvider(id, query, controller.signal).then((payload) => ({ id, payload }))
  })

  const stopAll = () => {
    for (const controller of controllers.values()) controller.abort()
  }
  signal?.addEventListener('abort', stopAll, { once: true })

  type Answer = { id: string; payload: ProviderPayload } | null
  /* every answer is written down the moment it arrives, whatever the walk
     is doing — so the deadline sweep below can see what has landed */
  const answers: Answer[] = running.map(() => null)
  running.forEach((promise, i) => {
    void promise.then((a) => {
      answers[i] = { id: a.id, payload: a.payload } as Answer
    })
  })

  /* the deadline backstop: a timer that resolves a promise the walk races */
  let fireDeadline!: () => void
  const deadline = new Promise<void>((resolve) => {
    fireDeadline = resolve
  })
  const timer = setTimeout(fireDeadline, CHAIN_DEADLINE_MS)

  try {
    /* the walk is IN the person's order: provider zero is awaited first —
       it has been running the whole time in parallel, so awaiting it costs
       only its own slack — and the chain returns the moment IT has a
       song. A provider with nothing just moves the walk to the next.
       After the deadline the race stops blocking (the deadline promise is
       resolved for good), so the same walk reads whatever HAS arrived and
       still takes the first payload in order. */
    for (let i = 0; i < running.length; i += 1) {
      await Promise.race([running[i], deadline])
      if (signal?.aborted) return null
      const answer = answers[i]
      if (answer?.payload) return answer
    }
    /* every provider in the order answered with nothing */
    return null
  } finally {
    clearTimeout(timer)
    fireDeadline()
    stopAll()
  }
}
