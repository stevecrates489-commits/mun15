/**
 * How do the two BetterLyrics routes behave across real tracks?
 *
 *   unison.boidu.dev/lyrics/search?q=      — fuzzy community search
 *   lyrics-api.boidu.dev/ttml/getLyrics    — exact metadata (song + artist)
 *
 * For each track this asks both and says what came back, with the artist
 * that answered, so the picker's rules can be written against reality.
 */

const TRACKS = [
  ['One More Time', 'Daft Punk', 320],
  ['Bohemian Rhapsody', 'Queen', 355],
  ['Shape of You', 'Ed Sheeran', 234],
  ['Blinding Lights', 'The Weeknd', 200],
  ['Hotel California', 'Eagles', 329],
  ['Love Of My Life', 'Queen', 259],
]

const strict = (a, b) => {
  const n = (v) =>
    String(v ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()
  const x = n(a)
  const y = n(b)
  return !!x && !!y && (x.includes(y) || y.includes(x))
}

for (const [title, artist, dur] of TRACKS) {
  console.log(`\n########## ${artist} — ${title} (${dur}s) ##########`)

  /* --- the exact-metadata route --- */
  for (const route of ['ttml', 'qq', 'getLyrics']) {
    const url = `https://lyrics-api.boidu.dev/${route}/getLyrics?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}&d=${dur}`
    const started = Date.now()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
      const body = await res.text()
      let keys = ''
      let size = 0
      let kind = ''
      try {
        const j = JSON.parse(body)
        keys = Object.keys(j).join(',')
        const l = typeof j.lyrics === 'string' ? j.lyrics : ''
        size = l.length
        kind = l.slice(0, 60).replace(/\s+/g, ' ')
      } catch {
        size = body.length
        kind = body.slice(0, 60).replace(/\s+/g, ' ')
      }
      console.log(
        `  ${route.padEnd(9)} ${res.status} ${String(Date.now() - started).padStart(5)}ms keys=[${keys}] len=${size} :: ${kind}`,
      )
    } catch (e) {
      console.log(`  ${route.padEnd(9)} FAILED ${e?.message ?? e} after ${Date.now() - started}ms`)
    }
  }

  /* --- the fuzzy community route --- */
  try {
    const res = await fetch(
      `https://unison.boidu.dev/lyrics/search?q=${encodeURIComponent(`${title} ${artist}`)}`,
      { signal: AbortSignal.timeout(12000) },
    )
    const j = await res.json()
    const list = Array.isArray(j?.data) ? j.data : []
    const hits = list.filter((c) => strict(c.artist, artist))
    console.log(`  unison    ${res.status} ${list.length} candidates, ${hits.length} artist-match`)
    for (const c of hits.slice(0, 4)) {
      console.log(
        `            match=${Number(c.matchScore ?? 0).toFixed(3)} dur=${c.duration} fmt=${c.format} vid=${c.videoId} :: ${JSON.stringify(c.artist)} — ${JSON.stringify(c.song)}`,
      )
    }
    if (!hits.length && list.length) {
      const c = list[0]
      console.log(
        `            best-by-score: match=${Number(c.matchScore ?? 0).toFixed(3)} dur=${c.duration} fmt=${c.format} vid=${c.videoId} :: ${JSON.stringify(c.artist)} — ${JSON.stringify(c.song)}`,
      )
    }
  } catch (e) {
    console.log(`  unison    FAILED ${e?.message ?? e}`)
  }
}
