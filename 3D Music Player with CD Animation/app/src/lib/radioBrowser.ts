/**
 * Radio Browser client (all.api.radio-browser.info — free, no key, ~40k
 * stations). Everything awkward about it is handled here so the UI does not
 * have to know:
 *
 *  - it is a FEDERATION: `all.` is DNS round-robin over community boxes that
 *    503 on their own schedule. Servers are discovered once, cached, and
 *    requests fail over down the list.
 *  - `url_resolved` is often empty → fall back to `url`.
 *  - a `.pls`/`.m3u` in `url` is a playlist, not a stream → resolve it.
 *  - the API sends CORS headers; the STREAMS usually do not. That is fine,
 *    because playback uses a bare <audio> element, which needs none. It is
 *    exactly why radio is NOT routed through the Web Audio graph.
 *  - an HTTPS page cannot play an HTTP stream (mixed content) → https-first
 *    ordering, http only as a fallback for local/dev origins.
 *  - `id` is server-local; `stationuuid` is the only stable identity.
 */

export interface Station {
  uuid: string
  name: string
  codec: string
  bitrate: number
  url: string
  country: string
  language: string
  tags: string
  votes: number
  clicks: number
  /* https streams only — a plain http URL is kept for dev/local origins */
  secure: boolean
}

export type SearchField = 'language' | 'country' | 'tag' | 'name'

const API_ROOT = 'https://all.api.radio-browser.info'
const SERVER_TTL = 20 * 60 * 1000
const RESULT_TTL = 15 * 60 * 1000

let servers: string[] = []
let serversAt = 0
let serverCursor = 0

const resultCache = new Map<string, { at: number; stations: Station[] }>()

const from = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

function normalize(raw: Record<string, unknown>): Station {
  const url = from(raw.url_resolved) || from(raw.url)
  return {
    uuid: from(raw.stationuuid) || url || from(raw.id),
    name: from(raw.name).trim() || 'Unnamed station',
    codec: (from(raw.codec) || '?').toUpperCase(),
    bitrate: num(raw.bitrate),
    url,
    country: from(raw.country),
    language: from(raw.language),
    tags: from(raw.tags),
    votes: num(raw.votes),
    clicks: num(raw.clickcount),
    secure: /^https:/i.test(url),
  }
}

/* playable-first ordering: an https mp3/aac stream is the most likely thing
   that simply works in this webview; http and exotic codecs sink to the end */
function rank(s: Station): number {
  let score = 0
  if (s.secure) score -= 40
  const codec = s.codec.toLowerCase()
  if (codec === 'mp3') score -= 30
  else if (codec === 'aac' || codec === 'aac+' || codec === 'aacp') score -= 20
  else if (codec === 'ogg' || codec === 'opus') score -= 5
  if (!s.url) score += 1000
  return score
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`radio-browser ${res.status}`)
  return res.json()
}

async function discoverServers(): Promise<string[]> {
  const now = Date.now()
  if (servers.length && now - serversAt < SERVER_TTL) return servers
  try {
    const list = (await fetchJson('/json/servers')) as Array<Record<string, unknown>>
    const hosts = list
      .map((s) => from(s.url) || from(s.name))
      .map((h) => h.replace(/^https?:\/\//, '').replace(/\/$/, ''))
      .filter(Boolean)
    if (hosts.length) {
      servers = hosts
      serversAt = now
    }
  } catch {
    /* the DNS name still works most of the time — fall back to it */
    if (!servers.length) servers = ['all.api.radio-browser.info']
  }
  return servers
}

/** request against the federation, failing over to the next healthy box */
async function request(path: string): Promise<unknown> {
  const hosts = await discoverServers()
  const start = serverCursor % hosts.length
  let lastErr: unknown = null
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[(start + i) % hosts.length]
    try {
      const res = await fetch(`https://${host}${path}`, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`${host} ${res.status}`)
      serverCursor = (start + i + 1) % hosts.length /* round-robin the load */
      return await res.json()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('radio-browser unreachable')
}

function cached(key: string): Station[] | null {
  const hit = resultCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > RESULT_TTL) {
    resultCache.delete(key)
    return null
  }
  return hit.stations
}

export async function searchStations(field: SearchField, query: string, limit = 60): Promise<Station[]> {
  const key = `${field}:${query.toLowerCase()}:${limit}`
  const hit = cached(key)
  if (hit) return hit

  const q = new URLSearchParams({
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
    limit: String(limit),
  })
  /* each field is its own API parameter — they cannot be combined blindly */
  q.set(field, query)
  if (field === 'country') q.set('country', query)

  const raw = (await request(`/json/stations/search?${q.toString()}`)) as Array<Record<string, unknown>>
  const stations = (Array.isArray(raw) ? raw : []).map(normalize).sort((a, b) => rank(a) - rank(b))
  resultCache.set(key, { at: Date.now(), stations })
  return stations
}

export async function popularStations(limit = 60): Promise<Station[]> {
  const key = `popular:${limit}`
  const hit = cached(key)
  if (hit) return hit
  const q = new URLSearchParams({ hidebroken: 'true', order: 'votes', reverse: 'true', limit: String(limit) })
  const raw = (await request(`/json/stations/search?${q.toString()}`)) as Array<Record<string, unknown>>
  const stations = (Array.isArray(raw) ? raw : []).map(normalize).sort((a, b) => rank(a) - rank(b))
  resultCache.set(key, { at: Date.now(), stations })
  return stations
}

/**
 * Every language the federation knows, most-stationed first. The search box
 * becomes a picker for this field, so nobody has to spell "Afrikaans" right.
 */
export async function listLanguages(): Promise<string[]> {
  const raw = (await request('/json/languages')) as Array<Record<string, unknown>>
  return (Array.isArray(raw) ? raw : [])
    .map((l) => ({ name: from(l.name), count: num(l.stationcount) }))
    .filter((l) => l.name && l.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((l) => l.name)
}

/** Every country the federation knows, most-stationed first. */
export async function listCountries(): Promise<string[]> {
  const raw = (await request('/json/countries')) as Array<Record<string, unknown>>
  return (Array.isArray(raw) ? raw : [])
    .map((c) => ({ name: from(c.name), count: num(c.stationcount) }))
    .filter((c) => c.name && c.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((c) => c.name)
}

/**
 * A `.pls`/`.m3u` in the URL column is a playlist, not a stream: the real
 * address is the first `File1=`/`http` line inside it. Fetched lazily and
 * only for those two shapes — plain streams are handed straight to <audio>.
 */
export async function resolveStream(url: string): Promise<string> {
  if (!/\.(pls|m3u|m3u8)(\?|$)/i.test(url)) return url
  try {
    const res = await fetch(url)
    if (!res.ok) return url
    const text = await res.text()
    const named = text.match(/^\s*File\d+\s*=\s*(\S+)/im)
    if (named) return named[1].trim()
    const bare = text.split('\n').map((l) => l.trim()).find((l) => /^https?:/i.test(l))
    return bare ?? url
  } catch {
    return url
  }
}
