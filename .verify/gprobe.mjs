/**
 * gprobe — is api.genius.com reachable with a REAL-shaped Bearer token?
 *
 * The token string below is syntactically real (32 hex chars) but not yours;
 * the question this answers is whether the edge even ASKS for it, or refuses
 * the IP before any credential is read. A 401 JSON from the API's own
 * contract ("authentication_failed") means the host is OPEN and a real token
 * unlocks it. A 403 HTML challenge means the IP is blocked at the edge and
 * no token can help from this machine.
 */

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

for (const url of [
  `https://api.genius.com/search?q=${encodeURIComponent('One More Time Daft Punk')}`,
  'https://api.genius.com/account/manage',
]) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.text()
    const isHtml = body.trimStart().startsWith('<')
    console.log(
      `[${res.status}] ${new URL(url).pathname} ${isHtml ? 'HTML PAGE — edge challenge, not the API answering' : `JSON: ${body.slice(0, 180)}`}`,
    )
  } catch (e) {
    console.log(`[0] ${new URL(url).pathname} ERR ${String(e).slice(0, 120)}`)
  }
}
