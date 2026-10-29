/* Command-line verification of the radio song clock and the level detector.
   Run: node tests/songclock.test.mts */
import { SongClock } from '../src/features/radio/songClock.ts'
import { EndDetector } from '../src/lib/radioLevel.ts'
import { cleanRadioArtist, cleanRadioPageTitle, cleanRadioTitle } from '../src/features/radio/radioLyrics.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`) }
}
function near(name: string, got: number, want: number, tol = 0.001) {
  const ok = Math.abs(got - want) <= tol
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${got}\n       want: ${want} (+-${tol})`) }
}

console.log('\n[1] the clock starts empty')
{
  const c = new SongClock()
  eq('no song -> no position', c.positionSec(10_000), 0)
  eq('no song -> no duration', c.snapshot().durationSec, 0)
}

console.log('\n[2] a position is dead-reckoned from the announcement')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 1_000)
  near('at the announcement the song is at 0', c.positionSec(1_000), 0)
  near('ten seconds later it is at 10', c.positionSec(11_000), 10)
  near('a minute later it is at 60', c.positionSec(61_000), 60)
}

console.log('\n[3] the position never runs backwards')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 1_000)
  near('a clock before the announcement reads zero', c.positionSec(0), 0)
}

console.log('\n[4] a late announcement is learned from the song it follows')
{
  const c = new SongClock()
  /* the song really began 5s before it was announced, and the studio track
     is 180s long, so the fade-out lands at 175s */
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 0)
  c.setDuration(180)
  c.noteEnd(175_000)
  near('the lag learned is 5s', c.snapshot().lagSec, 5)
}

console.log('\n[5] the learned lag carries over to the next song')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 0)
  c.setDuration(180)
  c.noteEnd(175_000)
  /* the next song is announced 200s later, and the clock already knows the
     station announces five seconds late */
  c.announce({ title: 'B', artist: 'X', url: 'u' }, 200_000)
  near('the next song starts five seconds in', c.positionSec(200_000), 5)
  near('and runs on from there', c.positionSec(230_000), 35)
}

console.log('\n[6] without a heard end the lag stays at zero')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 0)
  c.setDuration(180)
  /* an advertising break means the next announcement is late, and the clock
     cannot tell the break from a late announcement — so it assumes the
     announcement was on time */
  c.announce({ title: 'B', artist: 'X', url: 'u' }, 200_000)
  near('no lag is invented', c.snapshot().lagSec, 0)
  near('the next song starts at zero', c.positionSec(200_000), 0)
}

console.log('\n[7] a fade-out heard right after the announcement is ignored')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 10_000)
  /* a station that announces the next song early would otherwise have its
     new song ended the instant it started */
  c.noteEnd(11_000)
  eq('the song is not marked as ended', c.snapshot().ended, false)
}

console.log('\n[8] a real fade-out is recorded')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 10_000)
  c.noteEnd(180_000)
  eq('the song is marked as ended', c.snapshot().ended, true)
  near('and the end time is kept', c.snapshot().endedAt, 180_000)
  /* the position keeps running: the lyrics run out on their own, and a
     freeze on a false alarm would stop the highlight for the whole song */
  near('the position is not frozen', c.positionSec(190_000), 180)
}

console.log('\n[9] a new station clears the song but keeps the lesson')
{
  const c = new SongClock()
  c.announce({ title: 'A', artist: 'X', url: 'u' }, 0)
  c.setDuration(180)
  c.noteEnd(175_000)
  c.reset()
  eq('the song is gone', c.snapshot().song, null)
  near('but the lag is a property of the station, so it stays', c.snapshot().lagSec, 5)
}

console.log('\n[9b] the lesson belongs to its own station')
{
  const c = new SongClock()
  /* one station announces five seconds late */
  c.announce({ title: 'A', artist: 'X', url: 'slow' }, 0)
  c.setDuration(180)
  c.noteEnd(175_000)
  /* another one announces on time, and must not inherit the first one's habit */
  c.announce({ title: 'B', artist: 'X', url: 'quick' }, 200_000)
  near('a different station starts at zero', c.positionSec(200_000), 0)
  c.setDuration(180)
  c.noteEnd(375_000)
  near('and learns its own', c.snapshot().lagSec, 5)
  /* coming back to the first station keeps what it learned */
  c.announce({ title: 'C', artist: 'X', url: 'slow' }, 400_000)
  near('the first station is still five seconds late', c.positionSec(400_000), 5)
}

console.log('\n[10] the level detector: a steady song never ends')
{
  const d = new EndDetector()
  let fired = 0
  for (let i = 0; i < 60; i++) if (d.feed(0.5, i * 500)) fired++
  eq('no end is reported', fired, 0)
}

console.log('\n[11] the level detector: a fade-out is caught')
{
  const d = new EndDetector()
  for (let i = 0; i < 20; i++) d.feed(0.5, i * 500)
  /* 30dB below the song's own level, for three frames running */
  let firedAt = -1
  for (let i = 0; i < 6; i++) {
    if (d.feed(0.002, 10_000 + i * 500)) { firedAt = i; break }
  }
  near('the end is reported on the third quiet frame', firedAt, 2)
}

console.log('\n[12] the level detector: one end, not a stream of them')
{
  const d = new EndDetector()
  for (let i = 0; i < 20; i++) d.feed(0.5, i * 500)
  let fired = 0
  for (let i = 0; i < 20; i++) if (d.feed(0.002, 10_000 + i * 500)) fired++
  eq('the cooldown allows only one', fired, 1)
}

console.log('\n[13] the level detector: the warmup is honoured')
{
  const d = new EndDetector()
  let fired = 0
  for (let i = 0; i < 11; i++) if (d.feed(0.002, i * 500)) fired++
  eq('silence in the first seconds is not an ending', fired, 0)
}

console.log('\n[14] the level detector: a new song re-baselines')
{
  const d = new EndDetector()
  for (let i = 0; i < 20; i++) d.feed(0.5, i * 500)
  d.reset()
  let fired = 0
  for (let i = 0; i < 6; i++) if (d.feed(0.002, i * 500)) fired++
  eq('the new song needs its own baseline first', fired, 0)
}

console.log('\n[15] station titles are cleaned for the lyrics lookup')
{
  eq('a remaster suffix goes', cleanRadioTitle('Song Name (2020 Remaster)'), 'Song Name')
  eq('a live suffix goes', cleanRadioTitle('The Wind is Whispering - Live'), 'The Wind is Whispering')
  eq('stacked suffixes collapse', cleanRadioTitle('Song - Live (Remastered 2011)'), 'Song')
  eq('a feat goes', cleanRadioTitle('Tune (feat. Someone)'), 'Tune')
  eq('a plain title is untouched', cleanRadioTitle('Ordinary Song'), 'Ordinary Song')
  eq('an official video tag goes', cleanRadioPageTitle('Song (Official Video) [HD]'), 'Song')
  eq('a topic channel goes', cleanRadioArtist('James Brown - Topic'), 'James Brown')
  eq('a vevo channel goes', cleanRadioArtist('ModjoOfficial'), 'Modjo')
  eq('a plain artist is untouched', cleanRadioArtist('Daft Punk'), 'Daft Punk')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exit(1)
