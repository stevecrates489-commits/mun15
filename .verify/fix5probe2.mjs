/**
 * fix5probe2 — the follow-up: which ROUTE END TO END actually delivers?
 *  - Musixmatch desktop API with the RIGHT track: subtitle vs richsync vs lyrics
 *  - YouTube captions: Piped /streams on more instances, Invidious /captions
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
    } catch {}
    return { status: res.status, text, json }
  } catch (e) {
    return { status: 0, text: '', json: null, error: String(e).slice(0, 140) }
  }
}

console.log('\n== Musixmatch desktop: full flow, the RIGHT track ==')
const APP = 'web-desktop-app-v1.0'
{
  const t = await hit(`https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=${APP}&fmt=json`)
  const token = t.json?.message?.body?.user_token ?? null
  console.log(`  token: ${token ? 'got' : 'none'} (${t.json?.message?.header?.status_code})`)
  if (token) {
    const s = await hit(
      `https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=${encodeURIComponent('One More Time')}` +
        `&q_artist=${encodeURIComponent('Daft Punk')}&s_track_rating=desc&f_has_lyrics=1&f_music_genre_id=15` +
        `&page_size=10&page=1&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
    )
    const list = s.json?.message?.body?.track_list ?? []
    console.log(`  search: ${list.length} results`)
    for (const { track } of list.slice(0, 6)) {
      console.log(
        `    ${track.commontrack_id}  ${track.track_name} — ${track.artist_name}  (${track.track_length}s  rating ${track.track_rating ?? '-'})`,
      )
    }
    const right = list.find(({ track }) =>
      /one more time/i.test(track.track_name) && /daft punk/i.test(track.artist_name),
    )
    if (right) {
      const id = right.track.commontrack_id
      console.log(`  using commontrack_id ${id} — ${right.track.track_name}`)
      const sub = await hit(
        `https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?commontrack_id=${id}&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
      )
      const subBody = sub.json?.message?.body?.subtitle?.subtitle_body ?? null
      console.log(
        `  track.subtitle.get: [${sub.status}] status_code ${sub.json?.message?.header?.status_code}` +
          (subBody ? ` — ${subBody.length} chars` : ''),
      )
      if (subBody) console.log(`    head: ${JSON.stringify(subBody.slice(0, 150))}`)
      for (const raw of [sub.json?.message?.body?.subtitle?.subtitle_language, sub.json?.message?.message]) void raw
      const rich = await hit(
        `https://apic-desktop.musixmatch.com/ws/1.1/track.richsync.get?commontrack_id=${id}&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
      )
      const richBody = rich.json?.message?.body?.richsync?.richsync ?? null
      console.log(
        `  track.richsync.get: [${rich.status}] status_code ${rich.json?.message?.header?.status_code}` +
          (richBody ? ` — ${richBody.length} chars` : ''),
      )
      if (richBody) console.log(`    head: ${JSON.stringify(JSON.stringify(richBody).slice(0, 180))}`)
      const lyr = await hit(
        `https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?commontrack_id=${id}&app_id=${APP}&usertoken=${encodeURIComponent(token)}&fmt=json`,
      )
      const lyricBody = lyr.json?.message?.body?.lyrics?.lyrics_body ?? null
      console.log(
        `  track.lyrics.get: [${lyr.status}] status_code ${lyr.json?.message?.header?.status_code}` +
          (lyricBody ? ` — ${lyricBody.length} chars, head ${JSON.stringify(lyricBody.slice(0, 120))}` : ''),
      )
    }
  }
}

console.log('\n== Piped /streams, more instances ==')
const VIDEO_ID = 'wU26xVT_vBU'
for (const base of [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.ducks.party',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.librenode.link',
  'https://pipedapi.nosebs.ru',
]) {
  const r = await hit(`${base}/streams/${VIDEO_ID}`)
  const subs = r.json?.subtitles ?? []
  console.log(`  [${r.status}] ${base}/streams ${subs.length ? `→ ${subs.length} subtitle tracks!` : ''}`)
  if (subs.length) {
    console.log(`    sub0: fmt ${subs[0].format} url ${JSON.stringify(String(subs[0].url).slice(0, 90))}`)
    const cap = await hit(subs[0].url)
    console.log(`    caption: [${cap.status}] ${cap.text.length} bytes, head ${JSON.stringify(cap.text.slice(0, 150))}`)
    break
  }
}

console.log('\n== Invidious search + captions ==')
for (const base of [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://invidious.f5.si',
  'https://yewtu.be',
]) {
  const s = await hit(`${base}/api/v1/search?q=${encodeURIComponent('One More Time Daft Punk')}&type=video`)
  const vids = Array.isArray(s.json) ? s.json : []
  console.log(`  [${s.status}] ${base}/search → ${vids.length} videos`)
  if (s.status === 200 && vids.length) {
    const v = vids.find((x) => /daft/i.test(x.author ?? '') ) ?? vids[0]
    console.log(`    picked: ${v.videoId} — ${JSON.stringify(v.title)} — ${v.author}`)
    const c = await hit(`${base}/api/v1/captions/${v.videoId}`)
    console.log(`    captions list: [${c.status}] ${JSON.stringify(c.text.slice(0, 200))}`)
    if (c.status === 200) {
      const lab = (c.json?.captions ?? []).find((x) => /en/i.test(String(x.label ?? ''))) ?? c.json?.captions?.[0]
      if (lab) {
        const vtt = await hit(`${base}${lab.url}`)
        console.log(`    caption body: [${vtt.status}] ${vtt.text.length} bytes, head ${JSON.stringify(vtt.text.slice(0, 150))}`)
      }
    }
    break
  }
}
console.log('\ndone')
