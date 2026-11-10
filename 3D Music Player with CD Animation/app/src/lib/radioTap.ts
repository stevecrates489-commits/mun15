/**
 * A radio stream the Web Audio analyser is allowed to read.
 *
 * A station that sends no `Access-Control-Allow-Origin` is routed to silence
 * the moment its element enters an AudioContext — that is why the visualiser
 * stayed still for those stations. The native side can fetch the stream (it
 * is not bound by the browser's CORS rules) and the app's loopback server
 * re-serves the bytes with `*`, so a second, inaudible element can feed the
 * analyser without ever touching the element the listener hears.
 *
 * Outside Tauri (plain Vite in a browser) there is no native side; the
 * original URL is returned and the tap behaves exactly as before.
 */

import { invoke } from '@tauri-apps/api/core'

const cache = new Map<string, string>()

const inTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function radioVisualizerUrl(url: string): Promise<string> {
  if (!url || !inTauri()) return url
  const hit = cache.get(url)
  if (hit) return hit
  try {
    const proxied = await invoke<string>('radio_tap', { url })
    cache.set(url, proxied)
    return proxied
  } catch {
    /* the native tap is optional: without it the station simply keeps its
       old no-CORS behaviour instead of breaking playback */
    return url
  }
}
