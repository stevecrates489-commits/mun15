/**
 * What does the QQ QRC payload look like inside its XML wrapper?
 *
 * The lyric is in an ATTRIBUTE of the wrapper, so the question is whether the
 * attribute holds anything that needs XML decoding.
 */

const url =
  'https://lyrics-api.boidu.dev/qq/getLyrics?s=One%20More%20Time&a=Daft%20Punk&d=320'
const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
const body = await res.text()
console.log(`status ${res.status}  bytes ${body.length}`)

let parsed = null
try {
  parsed = JSON.parse(body)
} catch (e) {
  console.log(`not json: ${e?.message ?? e}`)
}
console.log(`keys: ${parsed ? Object.keys(parsed).join(',') : '-'}`)
console.log(`provider: ${JSON.stringify(parsed?.provider)}`)

const xml = String(parsed?.lyrics ?? '')
console.log(`xml length: ${xml.length}`)
console.log(`contains raw quote inside attr? ${/LyricContent="[^"]*"/.test(xml)}`)

const m = xml.match(/LyricContent="([\s\S]*?)"\s*\/?>/)
console.log(`attribute matched: ${!!m}`)
if (m) {
  const content = m[1]
  console.log(`attr length: ${content.length}`)
  console.log(`has &quot; ? ${content.includes('&quot;')}`)
  console.log(`has &amp; ? ${content.includes('&amp;')}`)
  console.log(`raw " inside? ${content.includes('"')}`)
  console.log('--- first 1400 chars ---')
  console.log(content.slice(0, 1400))
  console.log('--- last 300 chars ---')
  console.log(content.slice(-300))
}
