/* The harness's mount point for the real lyric panels.
   Run: node .verify/lyricscheck.mjs

   The panels are React components, and a React component cannot be checked by
   poking at the DOM it happened to render into — so this module mounts the
   REAL LyricsPanel and the REAL LyricsSettingsPanel into the page, and the
   harness then drives them the way a person would: clicking, dragging,
   reading what is on screen.

   It is a separate file from the harness on purpose. The harness is plain
   JavaScript that runs in Node; this one is a browser module with JSX in it,
   and it has to go through the dev server's transform to exist at all. */
import { StrictMode, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import LyricsPanel from '../app/src/components/LyricsPanel'
import type { LyricsApi } from '../app/src/components/LyricsPanel'
import LyricsSettingsPanel from '../app/src/components/LyricsSettingsPanel'

const TRACK = { title: 'One More Time', artist: 'Daft Punk', duration: 320 }

/** the words a PINNED lyric carries — the harness uses them to prove that a
    provider with nothing leaves the words on the screen alone */
const PINNED_TTML = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:00.00" end="00:03.00">Pinned words that must survive</p>
<p begin="00:03.00" end="00:06.00">A second pinned line</p>
</div></body></tt>`

interface Mounted {
  id: string
  apiRef: { current: LyricsApi | null }
  host: HTMLElement
  settingsHost: HTMLElement
  /** change the track the panel is showing — the sign that says "the lyrics
      are here" has to go with the song, so this needs to be provable */
  setTrack: (track: { title: string; artist: string; duration: number }) => void
}

declare global {
  interface Window {
    __mountLyrics?: (options?: {
      id?: string
      title?: string
      artist?: string
      duration?: number
      ttml?: string | null
    }) => Promise<void>
    __lyricsMounts?: Record<string, Mounted>
  }
}

/**
 * Mount both panels — the lyric surface and the settings panel that drives it.
 *
 * `ttml` mounts a PINNED lyric: the words are already on the screen and no
 * provider is asked for them. That is the case where a provider that has
 * nothing must leave the words alone, and the harness needs it.
 */
window.__mountLyrics = async (options = {}) => {
  const id = options.id ?? 'main'
  let track = {
    title: options.title ?? TRACK.title,
    artist: options.artist ?? TRACK.artist,
    duration: options.duration ?? TRACK.duration,
  }
  const ttml = options.ttml ?? null

  /* the boot overlay sits over everything; the panels must be seen, so it goes */
  const boot = document.getElementById('boot')
  if (boot) boot.remove()

  const host = document.createElement('div')
  host.id = `harness-lyrics-host-${id}`
  host.dataset.mount = id
  host.style.cssText =
    'position:fixed;left:40px;top:40px;width:760px;height:520px;z-index:9999;background:#05070a;overflow:hidden'
  document.body.appendChild(host)

  const apiRef = createRef<LyricsApi | null>()
  const root = createRoot(host)

  /* the panel is drawn from the track, and the track can change under it —
     that is the normal case in the app, and the sign that says "the lyrics
     are here" has to go with the song it belongs to */
  const renderPanel = () =>
    root.render(
      <StrictMode>
        <LyricsPanel
          title={track.title}
          artist={track.artist}
          duration={track.duration}
          playing={false}
          getTime={() => 0}
          onSeek={() => {}}
          size={28}
          mode="stage"
          brightness={100}
          offset={0}
          ttml={ttml}
          apiRef={apiRef}
        />
      </StrictMode>,
    )

  renderPanel()

  /* the api is filled in by the panel's effect, after the first commit */
  await new Promise((r) => setTimeout(r, 800))

  const settingsHost = document.createElement('div')
  settingsHost.id = `harness-lyrics-settings-${id}`
  settingsHost.dataset.mount = id
  settingsHost.style.cssText = 'position:fixed;left:840px;top:40px;z-index:9999'
  document.body.appendChild(settingsHost)

  const settingsRoot = createRoot(settingsHost)
  const renderSettings = () =>
    settingsRoot.render(
      <StrictMode>
        <LyricsSettingsPanel
          api={apiRef.current}
          mode="stage"
          onMode={() => {}}
          size={28}
          onSize={() => {}}
          brightness={100}
          onBrightness={() => {}}
          offset={0}
          onOffset={() => {}}
          pinned={!!ttml}
          onPin={() => {}}
          onUnpin={() => {}}
          onEdit={() => {}}
          onClose={() => {}}
        />
      </StrictMode>,
    )
  renderSettings()
  await new Promise((r) => setTimeout(r, 400))
  /* the api can land a beat after the first commit — if it did, draw again so
     the settings panel is talking to the panel and not to nothing */
  if (!apiRef.current) {
    renderSettings()
    await new Promise((r) => setTimeout(r, 400))
  }

  window.__lyricsMounts = window.__lyricsMounts ?? {}
  window.__lyricsMounts[id] = {
    id,
    apiRef,
    host,
    settingsHost,
    setTrack: (next) => {
      track = next
      renderPanel()
    },
  }
}
