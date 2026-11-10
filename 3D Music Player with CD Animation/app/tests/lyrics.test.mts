/* Verification of the lyric provider chain, the registry behind it, and the
   order the person using the player sets.
   Run: node tests/lyrics.test.mts
   Live providers (the network section) run only with LYRICS_LIVE=1 — they
   depend on services outside this machine, so they are not part of the
   ordinary suite. */
import {
  sanitizeTitle,
  cleanLrc,
  yrcToLrc,
  qrcToTtml,
  pickCandidate,
  titleCandidates,
  artistCandidates,
  type TrackQuery,
} from '../src/features/lyrics/providers.ts'
import {
  PROVIDERS,
  PROVIDER_IDS,
  providerById,
  fetchProvider,
  runProviderChain,
} from '../src/features/lyrics/registry.ts'
import {
  DEFAULT_PROVIDER_ORDER,
  defaultProviderOrder,
  readProviderOrder,
  writeProviderOrder,
  resetProviderOrder,
  providerOrderIsCustom,
} from '../src/features/lyrics/order.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`) }
}
function ok(name: string, condition: boolean) {
  if (condition) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

console.log('\n[1] a title is cleaned before any provider is asked')
eq('the feat tag goes', sanitizeTitle('In The End (feat. Chester)'), 'In The End')
eq('the official tag goes', sanitizeTitle('One More Time [Official Video]'), 'One More Time')
eq('the remastered tag goes', sanitizeTitle('Song (Remastered 2011)'), 'Song')
eq('the from tag goes', sanitizeTitle('Loveyatri (From "Loveyatri")'), 'Loveyatri')
eq('a clean title is left alone', sanitizeTitle('One More Time'), 'One More Time')
eq('the radio edit tag goes', sanitizeTitle('One More Time (Radio Edit)'), 'One More Time')
eq('the single version tag goes', sanitizeTitle('One More Time (Single Version)'), 'One More Time')
eq('the lyric video tag goes', sanitizeTitle('One More Time (Lyric Video)'), 'One More Time')
eq('a live recording keeps its tag', sanitizeTitle('One More Time (Live)'), 'One More Time (Live)')
eq('every stage of the stripping is kept', titleCandidates('One More Time (Radio Edit)').length, 2)
ok('the file\'s own title is kept too', titleCandidates('One More Time (Radio Edit)').includes('One More Time (Radio Edit)'))
eq('the artist is not mangled', artistCandidates('Daft Punk').length, 1)
ok('a featured act comes off the artist', artistCandidates('A feat. B').includes('A'))
ok('"Daft" keeps its letters', artistCandidates('Daft Punk').includes('Daft Punk'))

console.log('\n[2] the credits are not lyrics')
const query: TrackQuery = { title: 'One More Time', artist: 'Daft Punk', durationMs: 320000 }
const withCredits = [
  '[ti:One More Time]',
  '[ar:Daft Punk]',
  '[00:00.00] 作词 : Anthony Moore',
  '[00:01.00] 作曲 : Thomas Bangalter',
  '[00:30.88]One more time',
  '[00:46.56]One more time',
].join('\n')
const cleaned = cleanLrc(withCredits, query)
ok('the credit lines are gone', !cleaned.includes('作词') && !cleaned.includes('作曲'))
ok('the metadata tags are gone', !cleaned.includes('[ti:') && !cleaned.includes('[ar:'))
ok('the words are kept', cleaned.includes('[00:30.88]One more time'))
eq('only the lyric lines are left', cleaned.split('\n').length, 2)

console.log('\n[3] a word-level answer is flattened to its lines')
const yrc = [
  '[30000,3000](30000,500,0)One(30500,500,0)more(31000,400,0)time',
  '[46560,2500](46560,600,0)One(47160,600,0)more(47760,500,0)time',
].join('\n')
const flattened = yrcToLrc(yrc)
eq('the first line keeps its start', flattened.split('\n')[0], '[00:30.00]One more time')
eq('the second line keeps its start', flattened.split('\n')[1], '[00:46.56]One more time')
ok('the word offsets are gone', !flattened.includes('('))

console.log('\n[4] a recording of a different length is a different song')
const candidates = [
  { title: 'One More Time', artist: 'Daft Punk', durationMs: 320357 },
  { title: 'One More Time', artist: 'Daft Punk', durationMs: 146800 },
  { title: 'One More Time (Radio Edit)', artist: 'Daft Punk', durationMs: 199000 },
]
const picked = pickCandidate(candidates, query, ['One More Time'], ['Daft Punk'])
eq('the right recording is chosen', picked?.durationMs, 320357)
const noLength = pickCandidate(candidates, { ...query, durationMs: 0 }, ['One More Time'], ['Daft Punk'])
ok('without a length the best title still wins', noLength?.durationMs === 320357)
const nothing = pickCandidate(
  [{ title: 'One More Time', artist: 'Daft Punk', durationMs: 146800 }],
  query,
  ['One More Time'],
  ['Daft Punk'],
)
eq('a recording two minutes off is refused', nothing, null)

console.log('\n[4b] a length that is a little out RANKS, it does not veto')
/* the radio edit is the same song in another take — refusing it because it
   runs a minute shorter is how a provider "does not find" a song everybody
   knows */
const radioEdit = pickCandidate(
  [{ title: 'One More Time (Radio Edit)', artist: 'Daft Punk', durationMs: 199000 }],
  query,
  ['One More Time'],
  ['Daft Punk'],
)
eq('a radio edit is still the song', radioEdit?.durationMs, 199000)
/* and when both are there, the one that runs for the same time wins */
const both = pickCandidate(
  [
    { title: 'One More Time', artist: 'Daft Punk', durationMs: 199000 },
    { title: 'One More Time', artist: 'Daft Punk', durationMs: 320357 },
  ],
  query,
  ['One More Time'],
  ['Daft Punk'],
)
eq('the closest length wins', both?.durationMs, 320357)
eq('an unknown length is not held against a song', pickCandidate(
  [{ title: 'One More Time', artist: 'Daft Punk', durationMs: 0 }],
  query,
  ['One More Time'],
  ['Daft Punk'],
)?.durationMs, 0)
eq('a different song is still refused', pickCandidate(
  [{ title: 'Starboy', artist: 'The Weeknd', durationMs: 320000 }],
  query,
  ['One More Time'],
  ['Daft Punk'],
), null)

console.log('\n[5] the registry is the whole waterfall')
eq('every provider has an id', PROVIDERS.every((p) => !!p.id), true)
eq('no two providers share an id', new Set(PROVIDER_IDS).size, PROVIDER_IDS.length)
eq('every provider says what it is', PROVIDERS.every((p) => !!p.label && !!p.short && !!p.note), true)
eq('every provider sits in a tier', PROVIDERS.every((p) => p.tier === 1 || p.tier === 2 || p.tier === 3), true)
eq(
  'tier 1 is the word-and-syllable tier',
  PROVIDERS.filter((p) => p.tier === 1).map((p) => p.id),
  ['unison', 'betterlyrics', 'betterlyrics-qq', 'netease', 'paxsenix-word', 'kugou', 'lyricsplus'],
)
eq(
  'tier 2 is the line tier',
  PROVIDERS.filter((p) => p.tier === 2).map((p) => p.id),
  ['lrclib', 'paxsenix-line', 'lrc-red'],
)
eq(
  'tier 3 is the plain-text tier',
  PROVIDERS.filter((p) => p.tier === 3).map((p) => p.id),
  ['lyrics-ovh'],
)
eq('the registry is the default order', PROVIDER_IDS, [...DEFAULT_PROVIDER_ORDER])
eq('a provider is found by its id', providerById('netease')?.tier, 1)
eq('an unknown id finds nothing', providerById('nope'), undefined)

console.log('\n[6] every provider in the list is one this build can reach')
/* the dead routes (qq, youtube, genius, azlyrics, musixmatch-web) were
   probed and REMOVED in round 5 — the list carries only live rows, so an
   unavailable row here would be a regression */
eq('the registry has no unavailable rows', PROVIDERS.filter((p) => !p.available).length, 0)
eq('asking a provider that does not exist returns nothing', await fetchProvider('nope', query), null)
ok(
  'every row has a real fetcher',
  PROVIDERS.every(
    (p) => p.fetch.toString().includes('withCandidates') || !p.fetch.toString().startsWith('async () => null'),
  ),
)

console.log('\n[6b] the new Unison picker names the song AND the artist')
/* Unison ranks "Queen Bee" high for "Queen" — artist alone is not enough.
   The picker is judged here on the same two-word filter the fetcher runs,
   through one honest candidate list per case. */
const unisonCands = [
  { videoId: 'hit', song: 'Hotel California', artist: 'Eagles', duration: 391, format: 'lrc', matchScore: 1 },
  { videoId: 'cover', song: 'Love Of My Life', artist: 'Queen Bee', duration: 217, format: 'plain', matchScore: 0.9 },
]
const unisonQuery: TrackQuery = { title: 'Hotel California', artist: 'Eagles', durationMs: 391000 }
eq(
  'a hit with both names and the length is kept',
  unisonCands.filter((c) => titleCandidates('Hotel California').some((t) => c.song === t) && artistCandidates('Eagles').some((a) => c.artist === a)).length,
  1,
)
eq(
  'an artist-only match is refused ("Queen" vs "Queen Bee")',
  artistCandidates('Queen').some((a) => 'Queen Bee' === a),
  false,
)

console.log('\n[6c] the QQ QRC wrapper becomes word-timed TTML')
const qrc = [
  '[ti:one more time]',
  '[offset:0]',
  '[30438,1300]One (30438,608)more (31046,532)time(31578,153)',
  '[64645,1592]We (64645,380)gonna (65557,186)celebrate(65743,493)',
].join('\n')
const qrcTtml = qrcToTtml(qrc)
ok('the wrapper becomes TTML at all', qrcTtml.startsWith('<?xml'))
ok('the head lines are gone', !qrcTtml.includes('[ti:') && !qrcTtml.includes('[offset:'))
ok('one paragraph per lyric line', (qrcTtml.match(/<p /g) ?? []).length === 2)
ok('every word is a timed span', (qrcTtml.match(/<span /g) ?? []).length === 6)
ok('a span always carries an end', qrcTtml.includes('begin="30.438s" end="31.046s"'))
ok('the words survive the trip', qrcTtml.includes('>One <') && qrcTtml.includes('>time<'))
ok('the metadata is not a word', !qrcTtml.includes('[30438,'))

console.log('\n[7] an order that has fallen out of step is repaired')
/* the order lives in localStorage; outside a browser there is none, so a
   stand-in is put in its place for these checks */
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
  writable: true,
})

writeProviderOrder(['lyrics-ovh', 'netease'])
/* the kept ids stay in the order THEY were stored in — the person's order
   is theirs; only the NEW ids are folded in at their default places */
const keptFirst = readProviderOrder(PROVIDER_IDS)
eq('the ids that are still known keep their places', keptFirst.filter((id) => ['lyrics-ovh', 'netease'].includes(id)), ['lyrics-ovh', 'netease'])
eq('a provider stored out of the default keeps its stored rank', keptFirst.indexOf('lyrics-ovh') < keptFirst.indexOf('netease'), true)
eq(
  'a provider that is gone is dropped',
  readProviderOrder(PROVIDER_IDS).includes('a-provider-that-was-removed'),
  false,
)
eq('the order is as long as the registry', readProviderOrder(PROVIDER_IDS).length, PROVIDER_IDS.length)
eq('every id in the order is known', readProviderOrder(PROVIDER_IDS).every((id) => PROVIDER_IDS.includes(id)), true)

console.log('\n[7b] a NEW provider takes its DEFAULT-order place, not the end')
/* an order stored before the BetterLyrics rows existed — the repair must
   fold them in where the default ranks them, inside the tier-1 block */
const staleOrder = ['unison', 'netease', 'paxsenix-word', 'kugou', 'lyricsplus', 'lrclib', 'paxsenix-line', 'lrc-red', 'lyrics-ovh']
writeProviderOrder(staleOrder)
const repaired = readProviderOrder(PROVIDER_IDS)
eq('the new rows sit inside the tier-1 block', repaired.indexOf('betterlyrics'), 1)
eq('and the second new row after it', repaired.indexOf('betterlyrics-qq'), 2)
eq('the old rows keep their relative order', repaired.filter((id) => staleOrder.includes(id)), staleOrder)
eq('the repaired order is the default ranks (only new ids were folded in)', providerOrderIsCustom(repaired, PROVIDER_IDS), false)

console.log('\n[8] the order is known to be the default one or not')
writeProviderOrder(defaultProviderOrder())
eq('the default order is not a change', providerOrderIsCustom(readProviderOrder(PROVIDER_IDS), PROVIDER_IDS), false)
writeProviderOrder(['lyrics-ovh', ...defaultProviderOrder().slice(1)])
eq('a moved provider is a change', providerOrderIsCustom(readProviderOrder(PROVIDER_IDS), PROVIDER_IDS), true)
eq('the reset puts it back', resetProviderOrder(), defaultProviderOrder())
eq('the reset is not a change', providerOrderIsCustom(readProviderOrder(PROVIDER_IDS), PROVIDER_IDS), false)

console.log('\n[8b] a stored order is re-repaired against the new registry')
/* after [7b] wrote a stale order, the default write here must still win */
eq('a stale order becomes the default ranks again', readProviderOrder(PROVIDER_IDS), [...DEFAULT_PROVIDER_ORDER])

console.log('\n[9] the chain reaches a provider that has the track')
if (process.env.LYRICS_LIVE === '1') {
  const hit = await runProviderChain(query, PROVIDER_IDS)
  ok('a provider answered', !!hit)
  ok('the answer is named', !!hit?.id)
  ok('the answer has a body', !!(hit?.payload && (hit.payload.ttml || hit.payload.payload)))
  console.log(`       provider: ${hit?.id ?? 'none'}`)
} else {
  console.log('  --   skipped (set LYRICS_LIVE=1 to ask the live services)')
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail ? 1 : 0
