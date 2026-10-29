/* Command-line verification of the visualiser's sample pump.
   Run: node tests/visualizer.test.mts */
import { PcmTape } from '../src/features/visualizer/pcm.ts'
import { encodePcm, toBase64 } from '../src/features/visualizer/bridge.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`) }
}
function near(name: string, got: number, want: number, tol = 0.0001) {
  const ok = Math.abs(got - want) <= tol
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${got}\n       want: ${want} (+-${tol})`) }
}

/* a window of four frames, each frame one number */
const win = (...frames: number[]) => new Float32Array(frames)

console.log('\n[1] nothing arrives, nothing comes out')
{
  const tape = new PcmTape(4, 1)
  tape.advance(0, 44100)
  eq('no samples', tape.take(win(1, 2, 3, 4)), null)
}

console.log('\n[2] the first arrivals come out, newest last')
{
  const tape = new PcmTape(4, 1)
  /* a sixteenth of a second at 44.1kHz is 2756 samples — more than the
     window holds, so the whole window is what there is */
  tape.advance(0.0625, 44100)
  const chunk = tape.take(win(1, 2, 3, 4))
  eq('the whole window comes out', chunk?.frames, 4)
  eq('and it is the window', Array.from(chunk!.samples), [1, 2, 3, 4])
}

console.log('\n[3] a partly-filled window gives only the new end of it')
{
  const tape = new PcmTape(4, 1)
  /* two samples arrived, so the newest two of the window are the new ones */
  tape.advance(2 / 44100, 44100)
  const chunk = tape.take(win(1, 2, 3, 4))
  eq('two samples', chunk?.frames, 2)
  eq('and they are the newest', Array.from(chunk!.samples), [3, 4])
}

console.log('\n[4] the same window read twice gives nothing the second time')
{
  const tape = new PcmTape(4, 1)
  tape.advance(2 / 44100, 44100)
  const first = tape.take(win(1, 2, 3, 4))
  eq('the first read has them', first?.frames, 2)
  eq('the second read does not', tape.take(win(1, 2, 3, 4)), null)
}

console.log('\n[5] a later read picks up where the last one stopped')
{
  const tape = new PcmTape(4, 1)
  tape.advance(2 / 44100, 44100)
  tape.take(win(1, 2, 3, 4))
  /* the window has slid by two: it now holds 3, 4, 5, 6 */
  tape.advance(2 / 44100, 44100)
  const chunk = tape.take(win(3, 4, 5, 6))
  eq('two new samples', chunk?.frames, 2)
  eq('and they are the new ones', Array.from(chunk!.samples), [5, 6])
}

console.log('\n[6] interleaved channels stay interleaved')
{
  const tape = new PcmTape(4, 2)
  tape.advance(2 / 44100, 44100)
  const chunk = tape.take(new Float32Array([1, 10, 2, 20, 3, 30, 4, 40]))
  eq('two frames of two channels', chunk?.frames, 2)
  eq('two channels', chunk?.channels, 2)
  eq('the newest frame, both channels', Array.from(chunk!.samples), [3, 30, 4, 40])
}

console.log('\n[7] a clock that jumped gives the whole window, not nonsense')
{
  const tape = new PcmTape(4, 1)
  /* the tab was hidden: the clock moved a long way but the window only
     holds four frames, so four is what there is */
  tape.advance(10, 44100)
  const chunk = tape.take(win(1, 2, 3, 4))
  eq('the window comes out whole', chunk?.frames, 4)
  eq('and nothing is invented', Array.from(chunk!.samples), [1, 2, 3, 4])
}

console.log('\n[8] a clock that went backwards is ignored')
{
  const tape = new PcmTape(4, 1)
  tape.advance(2 / 44100, 44100)
  const chunk = tape.take(win(1, 2, 3, 4))
  eq('the first read still works', chunk?.frames, 2)
  /* the context was suspended and resumed: the clock can appear to go back */
  tape.advance(-1, 44100)
  eq('and the backwards jump adds nothing', tape.take(win(1, 2, 3, 4)), null)
}

console.log('\n[9] an empty source is not a crash')
{
  const tape = new PcmTape(4, 1)
  tape.advance(1 / 44100, 44100)
  eq('nothing comes out', tape.take(new Float32Array(0)), null)
}

console.log('\n[10] the base64 matches the browser’s own')
{
  /* the encoder is hand-written for speed, so it is checked against the
     standard one over every length and every byte value */
  const reference = (bytes: Uint8Array) =>
    btoa(String.fromCharCode.apply(null, Array.from(bytes)))
  for (const len of [0, 1, 2, 3, 4, 5, 6, 255, 256, 1023, 4096]) {
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff
    eq(`length ${len}`, toBase64(bytes), reference(bytes))
  }
  const every = new Uint8Array(256)
  for (let i = 0; i < 256; i++) every[i] = i
  eq('every byte value', toBase64(every), reference(every))
}

console.log('\n[11] the samples survive the trip')
{
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])
  const packet = encodePcm(samples, 1)
  eq('the channel count comes through', packet.channels, 1)
  const bytes = Uint8Array.from(atob(packet.samples), (c) => c.charCodeAt(0))
  const back = new Int16Array(bytes.buffer)
  eq('one sample per sixteen bits', back.length, samples.length)
  near('silence stays silence', back[0], 0)
  near('a half is a half', back[1], 16383, 2)
  near('a negative half is negative', back[2], -16383, 2)
  near('full scale is full scale', back[3], 32767)
  near('and the other way', back[4], -32767)
}

console.log('\n[12] a sample past full scale is clipped, not wrapped')
{
  const packet = encodePcm(new Float32Array([2, -2]), 1)
  const bytes = Uint8Array.from(atob(packet.samples), (c) => c.charCodeAt(0))
  const back = new Int16Array(bytes.buffer)
  near('too loud is clipped', back[0], 32767)
  near('and too quiet likewise', back[1], -32767)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exit(1)
