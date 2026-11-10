/**
 * What do the new endpoints actually answer with?
 *
 * The parsers have to be written against the real shape, so this prints the
 * status, the content type and the head of the body for each one.
 */

const TARGETS = [
  ['unison-search', 'https://unison.boidu.dev/lyrics/search?q=One%20More%20Time%20Daft%20Punk'],
  ['unison-video', 'https://unison.boidu.dev/lyrics?v=pwU6gWmb5yc'],
  ['betterlyrics-ttml', 'https://lyrics-api.boidu.dev/ttml/getLyrics?s=One%20More%20Time&a=Daft%20Punk&d=320'],
  ['betterlyrics-qq', 'https://lyrics-api.boidu.dev/qq/getLyrics?s=One%20More%20Time&a=Daft%20Punk&d=320'],
  ['betterlyrics-health', 'https://lyrics-api.boidu.dev/health'],
]

for (const [name, url] of TARGETS) {
  const started = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const body = await res.text()
    console.log(`\n===== ${name} =====`)
    console.log(`status   : ${res.status}`)
    console.log(`type     : ${res.headers.get('content-type')}`)
    console.log(`bytes    : ${body.length}  in ${Date.now() - started}ms`)
    console.log(`head     : ${JSON.stringify(body.slice(0, 700))}`)
  } catch (err) {
    console.log(`\n===== ${name} =====`)
    console.log(`FAILED   : ${err?.message ?? err}  after ${Date.now() - started}ms`)
  }
}
