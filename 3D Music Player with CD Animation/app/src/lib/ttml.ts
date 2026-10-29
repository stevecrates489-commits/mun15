/**
 * LRC / plain-text ⇄ TTML conversion.
 *
 * `<am-lyrics>` renders a string of TTML through its `ttml` property and, when
 * that property is set, makes NO network requests at all. That is what makes
 * two features cheap:
 *
 *   - pinning a fetched lyric locally (generate TTML from the component, store
 *     it, hand it straight back on the next play)
 *   - letting the user paste their own lyrics, in the format everyone actually
 *     has (LRC), and still get word-by-word sync
 *
 * So the local format is ALWAYS TTML, and the editor always speaks LRC.
 */

const TTML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml"><body><div>'
const TTML_TAIL = '</div></body></tt>'

/* [mm:ss.xx] / [mm:ss:xx] — one line may carry several, meaning it repeats */
const LRC_TAG = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
/* metadata lines that must not become lyrics */
const LRC_META = /^\s*\[(ti|ar|al|au|by|re|offset|length|ve|id)\s*:/i

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const lrcToSeconds = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'))

export const isTtml = (text: string) => /<tt[\s>]/i.test(text)

/** `12.5` → `"12.500s"`, a form the component's TTML time parser accepts */
const secs = (ms: number) => `${(ms / 1000).toFixed(3)}s`

interface Entry {
  begin?: number
  text: string
}

function parseUserLyrics(text: string): Entry[] {
  const out: Entry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || LRC_META.test(line)) continue
    const tags = [...line.matchAll(LRC_TAG)]
    if (!tags.length) {
      out.push({ text: line })
      continue
    }
    const body = line.slice(tags[tags.length - 1].index + tags[tags.length - 1][0].length).trim()
    if (!body) continue
    /* every tag on the line is a separate appearance of the same words */
    for (const t of tags) out.push({ begin: Math.round(lrcToSeconds(t[1], t[2]) * 1000), text: body })
  }
  return out
}

/**
 * User text → TTML. Timed lines get an `end` borrowed from the next line's
 * `begin` (the component needs a window to know when the highlight stops);
 * plain lines stay untimed and render as static text.
 */
export function lyricsToTtml(text: string): string {
  const entries = parseUserLyrics(text)
  if (!entries.length) return ''
  let xml = TTML_HEAD
  entries.forEach((e, i) => {
    if (e.begin === undefined) {
      xml += `<p>${escapeXml(e.text)}</p>`
      return
    }
    const next = entries.slice(i + 1).find((x) => x.begin !== undefined)
    const end = next && next.begin !== undefined ? next.begin : e.begin + 6000
    xml += `<p begin="${secs(e.begin)}" end="${secs(Math.max(end, e.begin + 200))}">${escapeXml(e.text)}</p>`
  })
  return xml + TTML_TAIL
}

/** TTML → LRC, so the editor can show what is already stored */
export function ttmlToLrc(ttml: string): string {
  try {
    const doc = new DOMParser().parseFromString(ttml, 'text/xml')
    if (doc.querySelector('parsererror')) return ''
    const out: string[] = []
    doc.querySelectorAll('p').forEach((p) => {
      const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text) return
      const begin = p.getAttribute('begin')
      if (!begin) {
        out.push(text)
        return
      }
      const secs = Number(begin.replace(/[hm]s?$/, '').replace('s', '')) || 0
      const m = Math.floor(secs / 60)
      const s = (secs - m * 60).toFixed(2).padStart(5, '0')
      out.push(`[${String(m).padStart(2, '0')}:${s}]${text}`)
    })
    return out.join('\n')
  } catch {
    return ''
  }
}
