/**
 * fix5probe — are Claude's five "make them work" routes actually alive?
 *
 * The claims: Piped search→captions for YouTube; apic-desktop.musixmatch.com
 * guest-token flow; api.genius.com with a Bearer token; lyrica.vercel.app as
 * the AZLyrics mirror; an api.betterlyrics.org/provider/qq bridge.
 * Each is probed from this machine the way the shell asks: plain HTTPS, no
 * browser, with the headers the flow itself requires.
 */

const TIMEOUT = 15_000
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function hit(url, opts = {}) {
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { 'User-Agent': UA, ...(opts.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* not json — the head of the text is what matters then */
    }
    return { status: res.status, text, json }
  } catch (e) {
    return { status: 0, text: '', json: null, error: String(e).slice(0, 140) }
  }
}

const say = (name, r, extra = '') =>
  console.log(`  [${r.status}] ${name}${extra ? ` — ${extra}` : ''}${r.error ? ` ERR ${r.error}` : ''}`)

console.log('\n== 1. YouTube through Piped ==')
{
  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
    'https://pipedapi.ducks.party',
    'https://pipedapi.reallyaweso.me',
  ]
  let videoId = null
  for (const base of instances) {
    const r = await hit(`${base}/search?q=${encodeURIComponent('One More Time Daft Punk')}&filter=music_songs`)
    const items = r.json?.items ?? []
    say(`search ${base}`, r, `${items.length} items`)
    if (r.status === 200 && items.length) {
      console.log(`       first: ${JSON.stringify({ url: items[0].url, title: items[0].title, uploader: items[0].uploaderName })}`)
      videoId = String(items[0].url ?? '').split('v=')[1]?.split('&')[0] ?? null
      if (videoId) {
        console.log(`       videoId picked: ${videoId}`)
        const s = await hit(`${base}/streams/${videoId}`)
        const subs = s.json?.subtitles ?? []
        say(`streams ${base}`, s, `${subs.length} subtitle tracks`)
        if (subs.length) {
          console.log(`       sub[0]: ${JSON.stringify({ url: subs[0].url?.slice(0, 90), format: subs[0].format, code: subs[0].code })}`)
          const cap = await hit(subs[0].url)
          say('caption body', cap, `${cap.text.length} bytes; starts: ${JSON.stringify(cap.text.slice(0, 160))}`)
        }
        break
      }
    }
  }
  if (!videoId) console.log('  no live Piped instance answered')
}

console.log('\n== 2. Musixmatch desktop API, guest token ==')
{
  const APP = 'web-desktop-app-v1.0'
  const t = await hit(`https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=${APP}&fmt=json`)
  const token = t.json?.message?.body?.user_token ?? null
  say('token.get', t, token ? `token: ${String(token).slice(0, 18)}… (${t.json.message.header.status_code})` : `status_code ${t.json?.message?.header?.status_code}`)
  if (token) {
    const q = await hit(
      `https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=${encodeURIComponent('One More Time')}` +
        `&q_artist=${encodeURIComponent('Daft Punk')}&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
    )
    const list = q.json?.message?.body?.track_list ?? []
    say('track.search', q, `${list.length} tracks; first commontrack_id ${list[0]?.track?.commontrack_id ?? '-'}`)
    if (list.length) {
      const id = list[0].track.commontrack_id
      const name = `${list[0].track.track_name} — ${list[0].track.artist_name}`
      console.log(`       first track: ${name}`)
      const rich = await hit(
        `https://apic-desktop.musixmatch.com/ws/1.1/track.richsync.get?commontrack_id=${id}&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
      )
      const rsBody = rich.json?.message?.body?.richsync ?? null
      say('track.richsync.get', rich, rsBody ? `sync type ${rsBody.sync_type}, ${rsBody.richsync?.length ?? 0} lines` : `status_code ${rich.json?.message?.header?.status_code}`)
      const lyr = await hit(
        `https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?commontrack_id=${id}&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
      )
      const lyricBody = lyr.json?.message?.body?.lyrics?.lyrics_body ?? null
      say('track.lyrics.get', lyr, lyricBody ? `${lyricBody.length} chars` : `status_code ${lyr.json?.message?.header?.status_code}`)
      if (lyricBody) console.log(`       first line: ${JSON.stringify(lyricBody.split('\n')[0])}`)
    }
  }
}

console.log('\n== 3. Genius official API, reachability ==')
{
  const r = await hit('https://api.genius.com/search?q=One%20More%20Time%20Daft%20Punk')
  say('api.genius.com/search (no token)', r, r.json?.meta?.status ? `message_status ${r.json.meta.message}` : r.text.slice(0, 80))
  /* with a deliberately WRONG token the answer shape tells us what a real
     token would change — a 401 on both is expected; the point is the host
     is reachable and the contract is as documented */
  const w = await hit('https://api.genius.com/search?q=test', {
    headers: { Authorization: 'Bearer deliberatelywrong' },
  })
  say('api.genius.com/search (bad token)', w, w.json?.meta?.message ?? '')
}

console.log('\n== 4. AZLyrics through the Lyrica mirror ==')
{
  const r = await hit('https://lyrica.vercel.app/api/azlyrics?artist=Daft%20Punk&song=One%20More%20Time')
  say('lyrica /api/azlyrics', r, r.text ? `${r.text.length} bytes; head: ${JSON.stringify(r.text.slice(0, 120))}` : '')
  const alt = await hit('https://lyrica.vercel.app/api/azlyrics?artist=Daft%20Punk&song=One%20More%20Time&format=json')
  say('lyrica /api/azlyrics?format=json', alt, alt.text ? `${alt.text.length} bytes` : '')
  const root = await hit('https://lyrica.vercel.app/')
  say('lyrica root', root, root.text ? `${root.text.length} bytes` : '')
}

console.log('\n== 5. The BetterLyrics QQ bridge ==')
{
  const tries = [
    'https://api.betterlyrics.org/provider/qq?artist=Daft%20Punk&title=One%20More%20Time',
    'https://api.betterlyrics.org/qq/getLyrics?s=One%20More%20Time&a=Daft%20Punk&d=320',
    'https://api.betterlyrics.org/health',
    'https://api.betterlyrics.org/',
  ]
  for (const url of tries) {
    const r = await hit(url)
    say(url.replace('https://', ''), r, r.text ? `${r.text.length} bytes; head: ${JSON.stringify(r.text.slice(0, 100))}` : '')
  }
}
console.log('\ndone')
