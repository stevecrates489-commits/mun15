/* providerprobe — run the app's OWN provider fetchers, one by one, and say
   what each one answered.

   This is the same code the player runs (features/lyrics/providers.ts), so a
   provider that misses here misses in the player too, and the reason is in
   the output rather than in a guess.

   Run: node .verify/providerprobe.mjs
   Pass a different song:  node .verify/providerprobe.mjs "Bohemian Rhapsody" "Queen" 355 */
import {
  fetchNetEase,
  fetchKuGou,
  fetchQQ,
  fetchLrclib,
  fetchLrcRed,
  fetchGenius,
  fetchLyricsOvh,
  fetchUnison,
  fetchKpoe,
  KPOE_SOURCE_ORDERS,
  titleCandidates,
  artistCandidates,
} from '../3D Music Player with CD Animation/app/src/features/lyrics/providers.ts'

const title = process.argv[2] ?? 'One More Time'
const artist = process.argv[3] ?? 'Daft Punk'
const durationMs = Number(process.argv[4] ?? 320) * 1000

const query = { title, artist, durationMs }
const titles = titleCandidates(title)
const artists = artistCandidates(artist)

console.log(`\n"${title}" by "${artist}"  (${durationMs / 1000}s)`)
console.log(`title candidates:   ${JSON.stringify(titles)}`)
console.log(`artist candidates:  ${JSON.stringify(artists)}\n`)

const providers = [
  { label: 'Unison', run: () => fetchUnison(query, titles, artists) },
  { label: 'NetEase', run: () => fetchNetEase(query, titles, artists) },
  { label: 'QQ Music', run: () => fetchQQ(query, titles, artists) },
  {
    label: 'PaxSenix (word)',
    run: () => fetchKpoe(query, titles, artists, KPOE_SOURCE_ORDERS['paxsenix-word'], 'PaxSenix'),
  },
  { label: 'KuGou', run: () => fetchKuGou(query, titles, artists) },
  {
    label: 'LyricsPlus',
    run: () => fetchKpoe(query, titles, artists, KPOE_SOURCE_ORDERS.lyricsplus, 'LyricsPlus'),
  },
  { label: 'LRCLIB', run: () => fetchLrclib(query, titles, artists) },
  {
    label: 'PaxSenix (line)',
    run: () => fetchKpoe(query, titles, artists, KPOE_SOURCE_ORDERS['paxsenix-line'], 'PaxSenix'),
  },
  { label: 'lrc.red', run: () => fetchLrcRed(query, titles, artists) },
  { label: 'Genius', run: () => fetchGenius(query, titles, artists) },
  { label: 'Lyrics.ovh', run: () => fetchLyricsOvh(query, titles, artists) },
]

const results = await Promise.all(
  providers.map(async (p) => {
    const t0 = Date.now()
    try {
      const answer = await p.run()
      return { ...p, ms: Date.now() - t0, answer }
    } catch (e) {
      return { ...p, ms: Date.now() - t0, error: String(e).slice(0, 120) }
    }
  }),
)

for (const r of results) {
  if (r.error) {
    console.log(`  MISS  ${r.label.padEnd(18)} ${String(r.ms).padStart(6)}ms  threw: ${r.error}`)
    continue
  }
  const a = r.answer
  if (!a) {
    console.log(`  MISS  ${r.label.padEnd(18)} ${String(r.ms).padStart(6)}ms  no answer`)
    continue
  }
  const size = a.kind === 'kpoe' ? JSON.stringify(a.payload).length : (a.ttml || '').length
  const lines =
    a.kind === 'kpoe'
      ? ((a.payload && a.payload.lyrics && a.payload.lyrics.length) || 0)
      : ((a.ttml || '').match(/<p[ >]/g) || []).length
  console.log(
    `  HIT   ${r.label.padEnd(18)} ${String(r.ms).padStart(6)}ms  ${a.kind}  ${lines} lines  ${size} bytes`,
  )
}

console.log()
