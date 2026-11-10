/**
 * What does the Unison search actually return for a known song?
 *
 * The parser has to pick the right candidate out of the list, so this prints
 * the fields that decide it for the first handful of hits.
 */

const q = process.argv[2] ?? 'One More Time Daft Punk'
const res = await fetch(`https://unison.boidu.dev/lyrics/search?q=${encodeURIComponent(q)}`, {
  signal: AbortSignal.timeout(15000),
})
const found = await res.json()
const list = Array.isArray(found?.data) ? found.data : []
console.log(`status ${res.status}  success=${found?.success}  candidates=${list.length}`)
console.log('')
for (const c of list.slice(0, 12)) {
  console.log(
    [
      `match=${Number(c.matchScore ?? 0).toFixed(3)}`,
      `eff=${Number(c.effectiveScore ?? 0).toFixed(3)}`,
      `dur=${c.duration}`,
      `fmt=${c.format}`,
      `sync=${c.syncType}`,
      `vid=${c.videoId}`,
      `artist=${JSON.stringify(c.artist)}`,
      `song=${JSON.stringify(c.song)}`,
    ].join('  '),
  )
}
