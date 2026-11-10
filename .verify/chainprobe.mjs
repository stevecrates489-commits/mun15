/* How long does the app's OWN chain take for one track, and who is slow?
 *
 * The player waits on `runProviderChain`, so this is the number the person
 * feels between a track starting and the words arriving.
 *
 * Run: node .verify/chainprobe.mjs "One More Time" "Daft Punk" 320
 */
import {
  runProviderChain,
  PROVIDERS,
} from '../3D Music Player with CD Animation/app/src/features/lyrics/registry.ts'

const title = process.argv[2] ?? 'One More Time'
const artist = process.argv[3] ?? 'Daft Punk'
const durationMs = Number(process.argv[4] ?? 320) * 1000
const query = { title, artist, durationMs }

console.log(`\n"${title}" by "${artist}"  (${durationMs / 1000}s)`)
console.log(`order: ${PROVIDERS.filter((p) => p.available).map((p) => p.id).join(' -> ')}\n`)

const t0 = Date.now()
const hit = await runProviderChain(query, PROVIDERS.map((p) => p.id))
const ms = Date.now() - t0

console.log(`  chain finished in ${ms}ms`)
console.log(`  winner: ${hit ? `${hit.id} (${hit.payload.kind})` : 'NONE — no provider had it'}\n`)
