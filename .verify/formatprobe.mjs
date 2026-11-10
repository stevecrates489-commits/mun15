/**
 * Two formats left to pin down:
 *   1. what the BetterLyrics TTML looks like inside <p> / <span>
 *   2. what Unison returns for a candidate whose format is 'lrc' or 'plain'
 */

const bl = await fetch(
  'https://lyrics-api.boidu.dev/ttml/getLyrics?s=One%20More%20Time&a=Daft%20Punk&d=320',
  { signal: AbortSignal.timeout(12000) },
).then((r) => r.json())
const ttml = String(bl?.lyrics ?? '')
const p = ttml.indexOf('<p ')
console.log('===== betterlyrics TTML =====')
console.log(`head: ${JSON.stringify(ttml.slice(0, 120))}`)
console.log(`first <p> block:\n${ttml.slice(p, p + 700)}`)

console.log('\n===== unison: lrc candidate =====')
for (const vid of ['BciS5krYL80', '_IL77qFKgRw']) {
  const res = await fetch(`https://unison.boidu.dev/lyrics?v=${vid}`, {
    signal: AbortSignal.timeout(12000),
  })
  const j = await res.json()
  const d = j?.data ?? {}
  const l = String(d?.lyrics ?? '')
  console.log(`--- ${vid} status=${res.status} keys=${Object.keys(d).join(',')}`)
  console.log(`    song=${JSON.stringify(d?.song)} artist=${JSON.stringify(d?.artist)} duration=${d?.duration}`)
  console.log(`    lyrics len=${l.length} head=${JSON.stringify(l.slice(0, 220))}`)
}
