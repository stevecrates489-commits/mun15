/**
 * The lyric providers, and what each of them is asked.
 *
 * Every provider here answers on its own: given a track, it either has a
 * lyric or it does not. Nothing is hidden inside a chain — the order the
 * providers are asked in belongs to the registry and to the person using
 * the player, not to this file.
 *
 * Two rules shape all of it:
 *
 *   1. Nothing here changes how a lyric is DISPLAYED. Each provider's
 *      answer is normalised to the component's own line format, so a lyric
 *      from any of them is drawn by the same code as a pinned one.
 *
 *   2. A provider is asked with the track's own TITLE and ARTIST and
 *      LENGTH, and a recording that is more than a couple of seconds off is
 *      refused. A remix, an acoustic version and an album cut share a title
 *      and differ only in their timing, and a lyric that is out by more than
 *      that is worse than no lyric at all.
 */

import {
  TTML_HEAD,
  TTML_TAIL,
  escapeXml,
  isTtml,
  lyricsToTtml,
  secs,
} from '../../lib/ttml.ts'
import { httpGet, httpGetJson } from './http.ts'

/* ------------------------------------------------------------------ *
 * what a provider gives back
 * ------------------------------------------------------------------ */

/**
 * A provider's answer, in the form it arrived.
 *
 * TTML is what most of them speak; LyricsPlus has a payload of its own and
 * the component knows how to read it.
 */
export type ProviderPayload =
  | { kind: 'ttml'; label: string; ttml: string; synced: boolean }
  | { kind: 'kpoe'; label: string; payload: unknown; synced: boolean }

/** What the player wants a lyric for. */
export interface TrackQuery {
  title: string
  artist: string
  /** the track's own length in ms — 0 when it is not known */
  durationMs: number
}

/**
 * A song as a provider describes it.
 *
 * Every provider names its fields differently, so they are lifted into this
 * one shape before anything is compared.
 */
export interface SongCandidate {
  title: string
  artist: string
  durationMs: number
}

/**
 * How far apart two lengths may be and still be the same recording.
 *
 * Two seconds is the tolerance the community uses, and it is what separates
 * one recording from another when two of them share a name.
 */
const DURATION_TOLERANCE_MS = 2_000

/**
 * How far apart two lengths may be and still be the SAME SONG.
 *
 * The comparison is a ratio, not a difference: a radio edit is 62% of the
 * album cut and is the same song, while a recording that is under half as
 * long is a DIFFERENT song — an extended mix, a live album cut — and its
 * words are not the words being sung.
 *
 * The tight two-second band is kept for RANKING (see `pickCandidate`); this
 * is the band for ACCEPTING. Refusing a song because its length is thirty
 * seconds off is how a provider ends up "not finding" a song everybody knows.
 */
const DURATION_SAME_SONG_RATIO = 0.5

/**
 * What ONE provider may spend on a track, all its attempts combined.
 *
 * A fetcher walks title variants × artist variants × catalogues, and every
 * step waits for its own answer: without a ceiling, `fetchKpoe`'s catalogue
 * walk alone can spend 25s and a three-title × two-artist provider can
 * spend 72s — and the chain runs them ALL at once, so the slowest provider
 * sets the pace of the whole track change. Six seconds is enough to answer,
 * and short enough that a straggler cannot hold the lyric hostage.
 */
const PROVIDER_BUDGET_MS = 6_000

/** is there still room in the budget a provider started with? */
const hasBudget = (started: number): boolean => Date.now() - started < PROVIDER_BUDGET_MS

/* ------------------------------------------------------------------ *
 * the query
 * ------------------------------------------------------------------ */

/**
 * The tags that name the SAME recording in a different way.
 *
 * `In The End (Official Video) [Remastered] ft. Chester` is not a title any
 * provider knows: asked for whole, every one of them answers with nothing.
 * The words are the same song, so the tag comes off and the title is asked
 * for again.
 *
 * What is NOT here: live, remix, acoustic, instrumental. Those are a
 * DIFFERENT recording — the words are different, and the wrong lyric is
 * worse than none.
 */
const CLUTTER = [
  /\(feat\.[^)]*\)|\[feat\.[^\]]*\]/gi,
  /\bft\.\s[^)\]]*/gi,
  /\(official[^)]*\)|\[official[^\]]*\]/gi,
  /\(lyric[^)]*\)|\[lyric[^\]]*\]/gi,
  /\(visualizer[^)]*\)|\[visualizer[^\]]*\]/gi,
  /\(audio[^)]*\)|\[audio[^\]]*\]/gi,
  /\(remaster(ed)?[^)]*\)|\[remaster(ed)?[^\]]*\]/gi,
  /[-–—]\s*remaster(ed)?\s*\d{0,4}\s*$/gi,
  /\(from "[^"]*"\)/gi,
  /\(radio edit\)|\[radio edit\]/gi,
  /\(single version\)|\[single version\]/gi,
  /\(album version\)|\[album version\]/gi,
  /\(explicit\)|\[explicit\]/gi,
  /\(bonus track[^)]*\)|\[bonus track[^\]]*\]/gi,
  /\(deluxe[^)]*\)|\[deluxe[^\]]*\]/gi,
  /\(\s*\)|\[\s*\]/g,
  /^\s*[-–—]\s*|\s*[-–—]\s*$/g,
]

/**
 * The titles worth asking with, each one cleaner than the last.
 *
 * Every stage of the stripping is kept: a provider that indexes the full
 * string is answered by the full string, and one that knows the song only
 * without the tag is answered by the stripped one. The raw title is kept at
 * the end for the same reason.
 */
export function titleVariants(raw: string): string[] {
  const list: string[] = []
  const push = (value: string) => {
    const v = value.replace(/\s+/g, ' ').trim()
    if (v && !list.includes(v)) list.push(v)
  }
  push(raw)
  let current = raw
  for (const rule of CLUTTER) {
    const next = current.replace(rule, ' ')
    if (next !== current) {
      current = next
      push(current)
    }
  }
  return list
}

/**
 * Strip the clutter a file name carries.
 *
 * The cleanest of the titles a file name can be asked under.
 */
export function sanitizeTitle(raw: string): string {
  const variants = titleVariants(raw)
  return variants.length ? variants[variants.length - 1] : raw.trim()
}

/** the titles worth asking with, cleanest first */
export function titleCandidates(raw: string): string[] {
  const list: string[] = []
  for (const variant of titleVariants(raw)) {
    if (!list.includes(variant)) list.push(variant)
  }
  return list
}

/** the artist string, split into the names a provider might know separately */
export function artistCandidates(raw: string): string[] {
  const list: string[] = []
  const push = (v: string) => {
    const t = v.trim()
    if (t && !list.includes(t)) list.push(t)
  }
  push(raw)
  /* "A, B, C" is a bill, not a name — the first act is the one a provider
     has indexed for most tracks */
  const first = raw.split(/[&,;]/)[0]?.trim()
  push(first ?? '')
  /* the featured act is on the song, not on the artist. The word boundary
     matters: "Daft Punk" has an "ft" in it. */
  push(raw.replace(/\s*[([]?\s*\b(feat|ft|featuring)\b\.?\s[^)\]]*[)\]]?/gi, ''))
  return list
}

/** compare two titles without their punctuation or their filler words */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** is this title close enough to be the same song? */
function titleMatches(candidate: string, wanted: string): boolean {
  const a = normalizeName(candidate)
  const b = normalizeName(wanted)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Choose the one song from a provider's list that is really this track.
 *
 * The NAME decides. A provider's list holds the song several times over — the
 * album cut, the radio edit, the remaster that gained a second — and the one
 * being played is the one whose name matches and whose length is closest.
 *
 * The length RANKS; it does not veto. It used to veto: a recording more than
 * two seconds away was dropped, and a file whose length differs from the
 * provider's by a few seconds got "no lyrics" for a song everybody knows.
 * The tight two-second band is what separates one recording from another;
 * the wide one (half again as long) is what separates one SONG from another,
 * and a song is refused only when it is out of that.
 */
export function pickCandidate(
  candidates: SongCandidate[],
  query: TrackQuery,
  titles: string[],
  artists: string[],
): SongCandidate | null {
  const usable = candidates.filter((c) => {
    if (!query.durationMs) return true
    if (!c.durationMs) return true
    /* a recording under half as long is a different song */
    const shorter = Math.min(c.durationMs, query.durationMs)
    const longer = Math.max(c.durationMs, query.durationMs)
    return shorter / longer >= DURATION_SAME_SONG_RATIO
  })
  if (!usable.length) return null

  let best: { song: SongCandidate; score: number } | null = null
  for (const song of usable) {
    let score = 0
    let named = false
    if (titles.some((t) => titleMatches(song.title, t))) {
      score += 10
      named = true
    } else if (titles.some((t) => normalizeName(song.title).includes(normalizeName(t)))) {
      score += 4
      named = true
    }
    /* A candidate whose NAME does not match is a different song, whatever its
       length says. Without this, a track that happens to run for the same
       time — or the same length as the thing being asked for — could answer
       for a song nobody asked about. */
    if (!named) continue
    if (artists.some((a) => titleMatches(song.artist, a))) score += 5
    /* the length breaks a tie between two recordings of the same song: the
       one that runs for the same time is the one being played */
    if (query.durationMs && song.durationMs) {
      const off = Math.abs(song.durationMs - query.durationMs)
      if (off <= DURATION_TOLERANCE_MS) score += 5
      else score -= Math.min(3, Math.floor(off / 10_000))
    }
    if (!best || score > best.score) best = { song, score }
  }
  if (!best) return null
  /* a wrong song is worse than no song */
  return best.score > 0 ? best.song : null
}

/* ------------------------------------------------------------------ *
 * the lyric text
 * ------------------------------------------------------------------ */

/**
 * Credit lines are not lyrics.
 *
 * NetEase and KuGou both open their files with the credits — "作词 : …",
 * "[ar:Daft Punk]" — and a panel that shows them is showing the back of the
 * sleeve where the words should be.
 */
const CREDIT_LINE =
  /^\s*(作词|作曲|编曲|制作人?|制作|混音|母带|录音|和声|吉他|贝斯|鼓手?|键盘|钢琴|弦乐|铜管|打击乐|监制|出品|发行|统筹|策划|配唱|和声编写|混音师|母带后期|录音师|音乐制作|乐队|人声|和声设计|原唱|演唱|特别鸣谢|歌词编写|词|曲|OP|SP|written by|composed by|arranged by|produced by|mixed by|mastered by|recorded by|lyrics by|music by|vocals?|producer|mix|master|engineer|label)\s*[:：]/i

/** drop the credits, and the file's own header line */
export function cleanLrc(raw: string, query: TrackQuery): string {
  const out: string[] = []
  const artists = artistCandidates(query.artist)
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    /* the timestamp comes off FIRST: a credit line reads "[00:00.00] 作词 : …",
       and the credit is in what follows the stamp */
    const body = trimmed.replace(/^\[[^\]]*\]\s*/, '')
    if (!body) continue
    if (CREDIT_LINE.test(body)) continue

    /* the opening line is sometimes the file's own header — the title with
       the artist on it, written as a lyric. The words of the song are kept:
       only a line that names the artist as well is a header, because a first
       line that IS the title ("One more time") is a real lyric. */
    if (out.length === 0) {
      const namesArtist = artists.some(
        (a) => a && normalizeName(body).includes(normalizeName(a)),
      )
      if (namesArtist && titleMatches(body, query.title)) continue
    }

    out.push(trimmed)
  }
  return out.join('\n')
}

/**
 * NetEase's word-level format, flattened to its lines.
 *
 * A line reads `[start,duration](wordStart,wordDuration,0)word…`. The panel
 * draws lines, so the line's own start is kept and the words are joined.
 *
 * The words carry no spaces between them — the tuples are the boundaries —
 * so the spaces have to be put back. For Chinese and Japanese there are no
 * spaces to put back, and adding them would be worse than leaving them out.
 */
export function yrcToLrc(raw: string): string {
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const head = trimmed.match(/^\[(\d+),(\d+)\]\s*(.*)$/)
    if (!head) continue
    const words = head[3]
      .split(/\(\d+,\d+,\d+\)/)
      .map((w) => w.trim())
      .filter(Boolean)
    const text = joinWords(words)
    if (!text) continue
    const totalMs = Number(head[1])
    const m = Math.floor(totalMs / 60_000)
    const s = ((totalMs - m * 60_000) / 1000).toFixed(2).padStart(5, '0')
    out.push(`[${String(m).padStart(2, '0')}:${s}]${text}`)
  }
  return out.join('\n')
}

/** CJK runs have no word spaces, so none are added between them */
const CJK_CHAR = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/

/** put the word boundaries back, as spaces where a space belongs */
function joinWords(words: string[]): string {
  let out = ''
  for (const word of words) {
    if (!out) {
      out = word
      continue
    }
    const prev = out[out.length - 1]
    const next = word[0]
    out += CJK_CHAR.test(prev) || CJK_CHAR.test(next) ? word : ` ${word}`
  }
  return out
}

/** a lyric that is a flat wall of text, with no timing at all */
export function plainToTtml(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (!lines.length) return ''
  return lyricsToTtml(lines.join('\n'))
}

/** base64 → text, the way several of these services wrap their answers */
export function decodeBase64(value: string): string {
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ *
 * the addresses
 * ------------------------------------------------------------------ */

const NETEASE = 'https://music.163.com'
const KUGOU_SEARCH = 'https://mobileservice.kugou.com/api/v3/search/song'
const KUGOU_LYRICS = 'https://krcs.kugou.com/search'
const KUGOU_DOWNLOAD = 'https://lyrics.kugou.com/download'
const QQ_SEARCH = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const QQ_LYRICS = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
const LRCLIB = 'https://lrclib.net/api/search'
const UNISON = 'https://unison.boidu.dev/lyrics'
const LRC_RED_MATCH = 'https://lrc.red/match.json'
const LRC_RED_TTML = 'https://lrc.red/s'
const GENIUS = 'https://fetch-genius.samidy.workers.dev/'
const BETTERLYRICS_TTML = 'https://lyrics-api.boidu.dev/ttml/getLyrics'
const BETTERLYRICS_QQ = 'https://lyrics-api.boidu.dev/qq/getLyrics'

/**
 * LyricsPlus's own servers.
 *
 * It is the gateway the community uses for the Musixmatch and Spotify
 * catalogues — the same community sources the waterfall calls PaxSenix —
 * so asking it with a source list is how those are reached.
 */
const KPOE_SERVERS = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus-seven.vercel.app',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyrics-plus-backend.vercel.app',
]

/**
 * How long one catalogue of the LyricsPlus gateway gets.
 *
 * The gateway is the one service here that regularly goes quiet, and it is
 * asked once per catalogue — so the budget per attempt is short enough that
 * one silent catalogue does not cost the others their turn.
 */
const KPOE_TIMEOUT_MS = 5_000

/**
 * How many catalogues of the gateway are asked one at a time.
 *
 * The list a provider names can run to seven entries, and the gateway is a
 * community service: asking it seven times over is how it goes quiet. Four
 * is enough to cover the ones that answer.
 */
const KPOE_SOURCE_LIMIT = 4

/** what LyricsPlus should look in, and in what order */
export const KPOE_SOURCE_ORDERS = {
  lyricsplus: 'apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word',
  'paxsenix-word': 'musixmatch-word,musixmatch,spotify',
  'paxsenix-line': 'spotify',
} as const

/* ------------------------------------------------------------------ *
 * the providers
 * ------------------------------------------------------------------ */

/**
 * NetEase Cloud Music.
 *
 * The largest open catalogue of Western and global tracks, and the only one
 * of these that needs no key and no session. Its answer is a JSON document
 * with the lyric in either the plain (LRC) or the word-level (YRC) form.
 */
export async function fetchNetEase(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    if (!hasBudget(started)) return null
    const url =
      `${NETEASE}/api/search/get?s=${encodeURIComponent(title)}` +
      '&type=1&offset=0&total=true&limit=10'
    const found = await httpGetJson(url, { referer: `${NETEASE}/`, signal })
    if (!found || typeof found !== 'object') continue
    const songs = (found as { result?: { songs?: unknown[] } }).result?.songs
    if (!Array.isArray(songs)) continue

    const candidates: SongCandidate[] = songs
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        title: String(s.name ?? ''),
        artist: Array.isArray(s.artists)
          ? String((s.artists[0] as Record<string, unknown> | undefined)?.name ?? '')
          : '',
        durationMs: Number(s.duration ?? 0),
      }))
    const song = pickCandidate(candidates, query, titles, artists)
    if (!song) continue

    const match = songs.find((s) => {
      const rec = s as Record<string, unknown>
      return String(rec.id ?? '') !== '' && Number(rec.duration ?? 0) === song.durationMs
    }) as Record<string, unknown> | undefined
    const id = match ? String(match.id) : ''
    if (!id) continue

    const lyricUrl =
      `${NETEASE}/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1&rv=-1` +
      '&cp=false&lrc_t=0&nocomment=1&fmt=json'
    const lyric = await httpGetJson(lyricUrl, { referer: `${NETEASE}/`, signal })
    if (!lyric || typeof lyric !== 'object') continue
    const rec = lyric as { lrc?: { lyric?: string }; yrc?: { lyric?: string } }

    const plain = rec.lrc?.lyric?.trim() ?? ''
    const words = rec.yrc?.lyric?.trim() ?? ''
    const lrc = plain || (words ? yrcToLrc(words) : '')
    if (!lrc) continue

    const ttml = lyricsToTtml(cleanLrc(lrc, query))
    if (!ttml) continue
    return { kind: 'ttml', label: 'NetEase', ttml, synced: true }
  }
  return null
}

/**
 * KuGou.
 *
 * A Chinese catalogue with the same reach into international music. Its
 * search answers with a hash, and the lyric itself is behind a second and a
 * third request: the candidate list first, then a download against the
 * candidate's access key.
 */
export async function fetchKuGou(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    if (!hasBudget(started)) return null
    const keyword = artists.length ? `${title} ${artists[0]}` : title
    const url =
      `${KUGOU_SEARCH}?format=json&keyword=${encodeURIComponent(keyword)}` +
      '&page=1&pagesize=10&showtype=1'
    const found = await httpGetJson(url, { signal })
    if (!found || typeof found !== 'object') continue
    const info = (found as { data?: { info?: unknown[] } }).data?.info
    if (!Array.isArray(info)) continue

    const candidates: SongCandidate[] = info
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        title: String(s.songname ?? ''),
        artist: String(s.singername ?? ''),
        durationMs: Number(s.duration ?? 0) * 1000,
      }))
    const song = pickCandidate(candidates, query, titles, artists)
    if (!song) continue

    /* the entry the choice was made from — matched on its NAME and its length,
       because two songs in one list can share a length and the hash belongs
       to the song, not to the length */
    const match = info.find((s) => {
      const rec = s as Record<string, unknown>
      return (
        String(rec.hash ?? '') !== '' &&
        String(rec.songname ?? '') === song.title &&
        Number(rec.duration ?? 0) * 1000 === song.durationMs
      )
    }) as Record<string, unknown> | undefined
    const hash = match ? String(match.hash) : ''
    if (!hash) continue

    /* Only the hash. KuGou's own search takes an `album_audio_id` too, and
       with it the service answers with the lyrics of a completely different
       track — an audiobook, an instrumental — instead of the song the hash
       names. The hash alone asks the right question. */
    const lyricUrl =
      `${KUGOU_LYRICS}?ver=1&man=yes&client=pc&hash=${encodeURIComponent(hash)}`
    const listed = await httpGetJson(lyricUrl, { signal })
    if (!listed || typeof listed !== 'object') continue
    const candidatesList = (listed as { candidates?: unknown[] }).candidates
    if (!Array.isArray(candidatesList) || !candidatesList.length) continue
    const candidate = candidatesList[0] as Record<string, unknown>
    const accessKey = String(candidate.accesskey ?? '')
    const lyricId = String(candidate.id ?? '')
    if (!accessKey || !lyricId) continue

    const downloadUrl =
      `${KUGOU_DOWNLOAD}?ver=1&client=pc&fmt=lrc&charset=utf8` +
      `&accesskey=${encodeURIComponent(accessKey)}&id=${encodeURIComponent(lyricId)}&contentfmt=1`
    const downloaded = await httpGetJson(downloadUrl, { signal })
    if (!downloaded || typeof downloaded !== 'object') continue
    const encoded = String((downloaded as { content?: string }).content ?? '')
    if (!encoded) continue
    const lrc = decodeBase64(encoded)
    if (!lrc) continue

    const ttml = lyricsToTtml(cleanLrc(lrc, query))
    if (!ttml) continue
    return { kind: 'ttml', label: 'KuGou', ttml, synced: true }
  }
  return null
}

/**
 * QQ Music.
 *
 * The third of the three timed catalogues. Its answers are base64-wrapped
 * LRC like KuGou's, behind the same shape of request.
 */
export async function fetchQQ(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    if (!hasBudget(started)) return null
    const keyword = artists.length ? `${title} ${artists[0]}` : title
    const url = `${QQ_SEARCH}?p=1&n=10&w=${encodeURIComponent(keyword)}&format=json`
    const found = await httpGetJson(url, { referer: 'https://y.qq.com/', signal })
    if (!found || typeof found !== 'object') continue
    const list = (found as { data?: { song?: { list?: unknown[] } } }).data?.song?.list
    if (!Array.isArray(list)) continue

    const candidates: SongCandidate[] = list
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        title: String(s.songname ?? ''),
        artist: Array.isArray(s.singer)
          ? String((s.singer[0] as Record<string, unknown> | undefined)?.name ?? '')
          : '',
        durationMs: Number(s.interval ?? 0) * 1000,
      }))
    const song = pickCandidate(candidates, query, titles, artists)
    if (!song) continue

    const match = list.find((s) => {
      const rec = s as Record<string, unknown>
      return String(rec.songmid ?? '') !== '' && Number(rec.interval ?? 0) * 1000 === song.durationMs
    }) as Record<string, unknown> | undefined
    const mid = match ? String(match.songmid) : ''
    if (!mid) continue

    const lyricUrl =
      `${QQ_LYRICS}?songmid=${encodeURIComponent(mid)}&format=json&nobase64=1&g_tk=5381`
    const lyric = await httpGetJson(lyricUrl, { referer: 'https://y.qq.com/', signal })
    if (!lyric || typeof lyric !== 'object') continue
    const encoded = String((lyric as { lyric?: string }).lyric ?? '')
    if (!encoded) continue
    const lrc = decodeBase64(encoded)
    if (!lrc) continue

    const ttml = lyricsToTtml(cleanLrc(lrc, query))
    if (!ttml) continue
    return { kind: 'ttml', label: 'QQ Music', ttml, synced: true }
  }
  return null
}

/**
 * LRCLIB.
 *
 * The gold standard for line sync: a plain open REST API, no key, and the
 * fastest answer of the timed ones. It publishes the length of each
 * recording, so the match is judged on the length rather than on the name.
 */
export async function fetchLrclib(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    if (!hasBudget(started)) return null
    const search = artists.length ? `${artists[0]} ${title}` : title
    const url = `${LRCLIB}?q=${encodeURIComponent(search)}`
    const found = await httpGetJson(url, { signal })
    if (!Array.isArray(found) || !found.length) continue

    const candidates: SongCandidate[] = found
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        title: String(s.trackName ?? ''),
        artist: String(s.artistName ?? ''),
        durationMs: Number(s.duration ?? 0) * 1000,
      }))
    const song = pickCandidate(candidates, query, titles, artists)
    if (!song) continue

    const match = found.find((s) => {
      const rec = s as Record<string, unknown>
      return Number(rec.duration ?? 0) * 1000 === song.durationMs
    }) as Record<string, unknown> | undefined
    if (!match) continue

    const synced = typeof match.syncedLyrics === 'string' ? match.syncedLyrics : ''
    const plain = typeof match.plainLyrics === 'string' ? match.plainLyrics : ''
    if (synced) {
      const ttml = lyricsToTtml(cleanLrc(synced, query))
      if (ttml) return { kind: 'ttml', label: 'LRCLIB', ttml, synced: true }
    }
    if (plain) {
      const ttml = plainToTtml(cleanLrc(plain, query))
      if (ttml) return { kind: 'ttml', label: 'LRCLIB', ttml, synced: false }
    }
  }
  return null
}

/**
 * Unison.
 *
 * The community's gateway to Apple's syllable-timed catalogue. It answers in
 * two steps: a SEARCH that returns a ranked list of candidates (each with a
 * `videoId`, the song and artist it names, its length and a `matchScore`),
 * then a FETCH of the full lyric for the one `videoId` chosen.
 *
 * The candidate's name is judged on BOTH words: the artist check alone is
 * not enough, because "Queen" matches "Queen Bee" and a wrong song is
 * worse than no song. The candidate ranking also carries Unison's own
 * `matchScore` — it is exactly 1.000 for the real song — so it is asked
 * for first among the candidates that pass both name checks.
 */
export async function fetchUnison(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const search = await httpGetJson(
        `${UNISON}/search?q=${encodeURIComponent(`${title} ${artist}`)}`,
        { signal },
      )
      if (!search || typeof search !== 'object') continue
      const list = (search as { data?: unknown[] }).data
      if (!Array.isArray(list)) continue

      /* the candidates that name THIS song, ranked the way the waterfall
         ranks them: the match score first, the length to break a tie */
      const ranked = list
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .filter(
          (c) =>
            titles.some((t) => titleMatches(String(c.song ?? ''), t)) &&
            artists.some((a) => titleMatches(String(c.artist ?? ''), a)),
        )
        .filter((c) => {
          const candidateMs = Number(c.duration ?? 0) * 1000
          if (!query.durationMs || !candidateMs) return true
          const shorter = Math.min(candidateMs, query.durationMs)
          const longer = Math.max(candidateMs, query.durationMs)
          return shorter / longer >= DURATION_SAME_SONG_RATIO
        })
        .map((c) => {
          const candidateMs = Number(c.duration ?? 0) * 1000
          const off = query.durationMs && candidateMs
            ? Math.abs(candidateMs - query.durationMs)
            : 0
          return {
            videoId: String(c.videoId ?? ''),
            format: String(c.format ?? 'plain'),
            score: Number(c.matchScore ?? 0) * 10 + (off && off <= DURATION_TOLERANCE_MS ? 5 : 0)
              - Math.min(3, Math.floor(off / 10_000)),
          }
        })
        .filter((c) => c.videoId)
        .sort((a, b) => b.score - a.score)

      for (const { videoId, format } of ranked) {
        const answer = await httpGetJson(`${UNISON}?v=${encodeURIComponent(videoId)}`, { signal })
        if (!answer || typeof answer !== 'object') continue
        const rec = answer as { success?: boolean; data?: { lyrics?: string } }
        if (!rec.success) continue
        const raw = rec.data?.lyrics?.trim()
        if (!raw) continue

        if (isTtml(raw)) {
          return { kind: 'ttml', label: 'Unison', ttml: raw, synced: true }
        }
        if (format === 'lrc') {
          const ttml = lyricsToTtml(cleanLrc(raw, query))
          if (ttml) return { kind: 'ttml', label: 'Unison', ttml, synced: true }
        }
        const ttml = plainToTtml(cleanLrc(raw, query))
        if (ttml) {
          return { kind: 'ttml', label: 'Unison', ttml, synced: format !== 'plain' }
        }
      }
    }
  }
  return null
}

/**
 * BetterLyrics · Apple TTML.
 *
 * The friends' own service, with the exact metadata routes: give it the
 * title, the artist and the length in seconds and it answers with the
 * Apple Music TTML the song was mastered with — word-timed, complete with
 * its recording credits.
 *
 * Its catalogue is CACHED: a song nobody has played through it yet answers
 * with a 401 ("API key required"). That is a clean miss, not a crash — the
 * provider stays silent and the chain asks the next one.
 */
export async function fetchBetterLyrics(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const params = new URLSearchParams({
        s: title,
        a: artist,
        d: String(query.durationMs > 0 ? Math.round(query.durationMs / 1000) : 0),
      })
      const answer = await httpGet(`${BETTERLYRICS_TTML}?${params.toString()}`, { signal })
      if (!answer.ok || !answer.body) continue
      let body: unknown
      try {
        body = JSON.parse(answer.body)
      } catch {
        continue
      }
      if (!body || typeof body !== 'object') continue
      const ttml = String((body as { lyrics?: string }).lyrics ?? '').trim()
      if (!ttml || !isTtml(ttml)) continue
      return { kind: 'ttml', label: 'BetterLyrics', ttml, synced: true }
    }
  }
  return null
}

/**
 * BetterLyrics · QQ QRC.
 *
 * The same service's route into QQ Music's karaoke catalogue. The answer is
 * an XML wrapper — `<QrcInfos>…<Lyric_1 LyricContent="…"/>…</QrcInfos>` —
 * and the lyric sits inside that wrapper's ATTRIBUTE, itself an LRC-like
 * text: a metadata head, then `[lineStart,lineDuration]words (wordStart,
 * wordDuration)…`, the word times ABSOLUTE milliseconds.
 *
 * It is converted here to TTML — one `<p>` with one `<span>` per word. Every
 * span carries BOTH a begin and an end: a span with only a begin reads as a
 * negative duration to the component's parser.
 */
export async function fetchBetterLyricsQq(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const params = new URLSearchParams({
        s: title,
        a: artist,
        d: String(query.durationMs > 0 ? Math.round(query.durationMs / 1000) : 0),
      })
      const answer = await httpGet(`${BETTERLYRICS_QQ}?${params.toString()}`, { signal })
      if (!answer.ok || !answer.body) continue
      let body: unknown
      try {
        body = JSON.parse(answer.body)
      } catch {
        continue
      }
      if (!body || typeof body !== 'object') continue
      const xml = String((body as { lyrics?: string }).lyrics ?? '')
      const matched = xml.match(/LyricContent="([\s\S]*?)"/)
      if (!matched) continue
      const qrc = qrcToTtml(decodeQrcEntities(matched[1]))
      if (qrc) return { kind: 'ttml', label: 'BetterLyrics · QQ', ttml: qrc, synced: true }
    }
  }
  return null
}

/** the entities an XML attribute can carry */
function decodeQrcEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * QQ's QRC word format → TTML.
 *
 * The head lines (`[ti:…]`, `[offset:0]`) are metadata, not lyrics — they go
 * the way the credit lines go. A lyric line reads
 * `[lineStart,lineDuration]word (wordStart,wordDuration)word …` and is
 * rebuilt as one `<p begin end>` holding one `<span begin end>` per word.
 */
export function qrcToTtml(raw: string): string {
  const lines: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const head = line.match(/^\[(\d+),(\d+)\](.*)$/)
    if (!head) continue
    const lineStart = Number(head[1])
    const lineDur = Number(head[2])
    const parts = head[3].split(/\((\d+),(\d+)\)/)
    /* the split comes back TEXT, START, DUR, TEXT, START, DUR … TEXT: the
       word comes BEFORE its tuple, so the text parts sit at even indexes */
    let xml = ''
    let wordsStart = Infinity
    let wordsEnd = 0
    let words = ''
    for (let i = 0; i + 2 < parts.length; i += 3) {
      if (i > 0) words += ' '
      const start = Number(parts[i + 1])
      const dur = Number(parts[i + 2])
      const word = parts[i] + (i + 3 < parts.length ? '' : '')
      wordsStart = Math.min(wordsStart, start)
      wordsEnd = Math.max(wordsEnd, start + dur)
      words += `<span begin="${secs(start)}" end="${secs(start + Math.max(dur, 1))}">${escapeXml(word)}</span>`
    }
    if (!words) continue
    /* the wrapper's own word times are the truth about where the line runs;
       the line header agrees with them, but only almost — the words' span
       is the one written down */
    const begin = wordsStart === Infinity ? lineStart : wordsStart
    const end = Math.max(wordsEnd, lineStart + Math.max(lineDur, 200))
    xml = `<p begin="${secs(begin)}" end="${secs(end)}">${words}</p>`
    lines.push(xml)
  }
  if (!lines.length) return ''
  return `${TTML_HEAD}${lines.join('')}${TTML_TAIL}`
}

/**
 * lrc.red.
 *
 * A community archive of timed lyrics, addressed by ISRC. Its matcher
 * answers with the ISRC of the recording it thinks is the right one, and
 * the lyric itself comes as TTML.
 */
export async function fetchLrcRed(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const params = new URLSearchParams({ track: title, artist })
      if (query.durationMs > 0) {
        params.set('duration', String(Math.round(query.durationMs / 1000)))
      }
      const found = await httpGetJson(`${LRC_RED_MATCH}?${params.toString()}`, { signal })
      if (!found || typeof found !== 'object') continue
      const hits = (found as { hits?: unknown[] }).hits
      if (!Array.isArray(hits) || !hits.length) continue
      const isrc = String((hits[0] as Record<string, unknown> | undefined)?.isrc ?? '').trim()
      if (!isrc) continue

      const answer = await httpGet(`${LRC_RED_TTML}/${encodeURIComponent(isrc)}.ttml`, { signal })
      if (!answer.ok || !answer.body) continue
      return { kind: 'ttml', label: 'lrc.red', ttml: answer.body, synced: true }
    }
  }
  return null
}

/**
 * Genius.
 *
 * The largest lyric archive in the world, and plain text only — the words
 * without the timing. The community's worker is used rather than the site
 * itself, which is what keeps the request from being refused.
 */
export async function fetchGenius(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const params = new URLSearchParams({ title, artist })
      const found = await httpGetJson(`${GENIUS}?${params.toString()}`, { signal })
      if (!found || typeof found !== 'object') continue
      const text = String((found as { lyrics?: string }).lyrics ?? '')
      if (!text.trim()) continue
      const ttml = plainToTtml(cleanLrc(text, query))
      if (!ttml) continue
      return { kind: 'ttml', label: 'Genius', ttml, synced: false }
    }
  }
  return null
}

/**
 * LyricsPlus, and the two PaxSenix views of the Musixmatch and Spotify
 * catalogues.
 *
 * LyricsPlus is the gateway the community uses for those catalogues: it
 * asks its own upstream services and answers with whichever one had the
 * song. Which catalogue is asked is the `source` parameter, so the same
 * gateway serves all three entries.
 *
 * The catalogues are asked ONE AT A TIME. The gateway takes a list of them,
 * but it is quicker when it is handed a single catalogue to look in, and a
 * list where one catalogue is slow costs the whole request — so the list is
 * asked first (the gateway's own way), and then each catalogue on its own,
 * in the order the entry names them, until one of them has the song.
 *
 * The SERVERS are asked at the same time. They are mirrors of one another,
 * so there is nothing to gain from trying them one after another and a lot
 * to lose: one mirror that is down would cost the whole request its time.
 */
export async function fetchKpoe(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  sourceOrder: string,
  label: string,
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const sources = sourceOrder
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  /* the walk is long — list + up to four catalogues — so the BUDGET is
     checked per catalogue, not per track: one silent catalogue must not
     spend the others' turn */
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const ask = async (source: string, servers: string[]) => {
        const params = new URLSearchParams({ title, artist, source })
        if (query.durationMs > 0) {
          params.set('duration', String(Math.round(query.durationMs / 1000)))
        }
        const answers = await Promise.all(
          servers.map((base) =>
            httpGetJson(`${base}/v2/lyrics/get?${params.toString()}`, {
              signal,
              timeoutMs: KPOE_TIMEOUT_MS,
            }),
          ),
        )
        for (const found of answers) {
          if (!found || typeof found !== 'object') continue
          const payload = found as { error?: unknown; lyrics?: unknown; type?: string }
          if (payload.error) continue
          const entries = payload.lyrics
          if (!Array.isArray(entries) || !entries.length) continue
          const synced = String(payload.type ?? '').toLowerCase() !== 'line'
          return { kind: 'kpoe', label, payload: found, synced } as ProviderPayload
        }
        return null
      }

      /* the whole list first, against every mirror at once */
      const whole = await ask(sourceOrder, KPOE_SERVERS)
      if (whole) return whole

      /* then each catalogue on its own. The mirrors are not asked again: the
         gateway is a community service and goes quiet when it is hammered,
         and one catalogue's silence must not cost the others their turn. */
      for (const source of sources.slice(0, KPOE_SOURCE_LIMIT)) {
        if (!hasBudget(started)) return null
        const one = await ask(source, [KPOE_SERVERS[0]])
        if (one) return one
      }
    }
  }
  return null
}

/**
 * lyrics.ovh.
 *
 * Plain text and nothing else — no timing at all — but it needs no key, has
 * open CORS headers and is the one service here that answers from a plain
 * browser. It is the last resort: the words on the screen are worth more
 * than the words in the right place.
 */
export async function fetchLyricsOvh(
  query: TrackQuery,
  titles: string[],
  artists: string[],
  signal?: AbortSignal,
): Promise<ProviderPayload | null> {
  const started = Date.now()
  for (const title of titles) {
    for (const artist of artists) {
      if (!hasBudget(started)) return null
      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
      const answer = await httpGet(url, { signal })
      if (!answer.ok || !answer.body) continue

      let text = answer.body
      try {
        const parsed = JSON.parse(answer.body) as { lyrics?: string }
        if (typeof parsed.lyrics === 'string') text = parsed.lyrics
      } catch {
        /* older answers are the plain text itself */
      }
      const cleaned = cleanLrc(text, query)
      if (!cleaned.trim()) continue
      const ttml = plainToTtml(cleaned)
      if (!ttml) continue
      return { kind: 'ttml', label: 'lyrics.ovh', ttml, synced: false }
    }
  }
  return null
}
