/* Writes one test page per provider.
 *
 * The pages are the same page with one provider named — the file name is the
 * provider's id, and the body says which one it is. Writing them by hand
 * would be eleven copies of the same file to keep in step.
 *
 * Run: node .verify/provider-tests/make-pages.mjs */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const IDS = [
  'unison',
  'netease',
  'qq',
  'paxsenix-word',
  'kugou',
  'lyricsplus',
  'lrclib',
  'youtube',
  'paxsenix-line',
  'lrc-red',
  'genius',
  'azlyrics',
  'lyrics-ovh',
  'musixmatch-web',
]

const page = (id) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${id} — lyric provider test</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body data-provider="${id}">
    <h1>${id}</h1>
    <p class="lede">
      One provider, on its own. Put a title, an artist and a length in at the top and press TEST:
      the card shows the address that was asked, the status, the body and how many lines of lyric
      came back. A provider tagged <b>SHELL</b> answers with no CORS header, so this page cannot
      read it — that refusal is the browser’s rule, not the provider’s, and the player asks those
      through its own shell where they work.
    </p>

    <form onsubmit="return false">
      <label>
        <span>TITLE</span>
        <input id="title" value="One More Time" />
      </label>
      <label>
        <span>ARTIST</span>
        <input id="artist" value="Daft Punk" />
      </label>
      <label>
        <span>LENGTH (SECONDS)</span>
        <input id="duration" value="320" />
      </label>
      <button id="test-all" type="button">TEST</button>
    </form>

    <div id="grid"></div>

    <script src="providers.js"></script>
    <script src="page.js"></script>
  </body>
</html>
`

for (const id of IDS) {
  writeFileSync(resolve(HERE, `${id}.html`), page(id), 'utf8')
  console.log(`wrote ${id}.html`)
}
