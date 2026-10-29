/**
 * The radio song clock — a playhead for a stream that has none.
 *
 * A live stream carries no position. Nothing in the bytes says "you are 42
 * seconds into this song": the ICY metadata only ever NAMES the song, and
 * the song's own length is unknown. So the position has to be dead-reckoned
 * — where the last announcement heard us, plus the time since.
 *
 * This is the same trick the karaoke project uses in radio mode, where the
 * identification comes from a fingerprint of the room rather than a title in
 * the stream. There the fingerprint takes ~10s to answer, so the offset it
 * reports is already stale and a forward lead is added on top. Here the
 * title is announced as the song starts, so the offset starts at zero and is
 * only ever nudged by what previous songs taught us.
 *
 * The correction is LEARNED, not guessed:
 *
 *   - a title arrives at T_start — the announcement may be late by L
 *   - the lyrics source reports the song's length D
 *   - the level detector hears the fade-out at T_end
 *
 * and then L = T_start - (T_end - D): the song really began L seconds
 * before it was announced. A station announces its titles at a fairly
 * consistent point, so L carries over to the next song — one song behind,
 * smoothed by an average. When the level detector is unavailable the same
 * arithmetic is done against the NEXT announcement instead, which folds any
 * advertising break into the measurement and leaves L at zero: a safe
 * default that assumes the title arrived on time.
 *
 * No DOM, no timers: the clock is pure arithmetic over timestamps, so it
 * can be tested on its own and sampled as often as the renderer likes.
 */

export interface ClockSong {
  title: string
  artist: string
  url: string
}

export interface ClockSnapshot {
  song: ClockSong | null
  /** wall-clock ms when the title was announced */
  startedAt: number
  /** seconds into the song at `startedAt` — the learned announcement lag */
  offsetSec: number
  /** the song's length in seconds, 0 when unknown */
  durationSec: number
  /** the song was heard to end (a fade-out, or silence) */
  ended: boolean
  /** ms when the song was heard to end, 0 when it was not */
  endedAt: number
  /** the smoothed lag learned from earlier songs, in seconds */
  lagSec: number
}

/* How much of a new measurement is folded into the running average. Low
   enough that one odd song (an edited radio cut, a long talk break) cannot
   drag the estimate, high enough to follow a station that changes its mind. */
const LAG_WEIGHT = 0.34
/* An announcement later than this is a broken clock, not a late station. */
const LAG_MAX = 30
/* how many stations' worth of lag to remember */
const LAG_STATIONS = 40
/* A fade-out heard within this of the announcement belongs to the PREVIOUS
   song: stations that announce early would otherwise end the new song the
   instant it starts. */
const MIN_SONG_AGE_MS = 3000

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export class SongClock {
  private song: ClockSong | null = null
  private startedAt = 0
  private offsetSec = 0
  private durationSec = 0
  private ended = false
  private endedAt = 0
  private lagSec = 0
  /* The lag is a property of the STATION, not of the session: one station
     announces its titles on the beat, another announces them after the
     advert. Keeping it per stream means tuning a different station does not
     corrupt what was learned, and coming back to a station keeps its own. */
  private lagByUrl = new Map<string, number>()
  /* which song the lag was last measured from, so one song is never counted
     twice — the measurement can be taken at several moments as the pieces
     arrive, and only the first complete one counts */
  private token = 0
  private learnedToken = -1

  /**
   * A new title: whatever was playing is over.
   *
   * The old song's numbers are still on the fields here, which is exactly
   * what the learning below needs — so it runs BEFORE anything is replaced.
   */
  announce(song: ClockSong, now: number): void {
    if (this.song) this.learn(now)
    this.song = song
    this.token += 1
    this.startedAt = now
    /* the position we are already at when the title shows up — this
       station's own lag, as far as it has been worked out */
    this.lagSec = this.lagByUrl.get(song.url) ?? 0
    this.offsetSec = this.lagSec
    this.durationSec = 0
    this.ended = false
    this.endedAt = 0
  }

  /**
   * The stream went quiet: the song is over at `now`.
   *
   * The position is NOT frozen — the lyrics run out on their own, and a
   * freeze on a false alarm would stop the highlight for the rest of the
   * song. This only records the time, which is what the learning needs.
   */
  noteEnd(now: number): void {
    if (!this.song) return
    if (now - this.startedAt < MIN_SONG_AGE_MS) return
    if (this.ended) return
    this.ended = true
    this.endedAt = now
    /* the end and the length are both known now, so the lag can be measured
       straight away rather than at the next announcement */
    this.learn()
  }

  /** The lyrics source reported the song's length. */
  setDuration(sec: number): void {
    if (!Number.isFinite(sec) || sec <= 0) return
    this.durationSec = sec
    /* the length may be the last piece the measurement was waiting for */
    this.learn()
  }

  /** Seconds into the song, as far as the clock can tell. */
  positionSec(now: number): number {
    if (!this.song) return 0
    const elapsed = (now - this.startedAt) / 1000
    return Math.max(0, this.offsetSec + elapsed)
  }

  snapshot(): ClockSnapshot {
    return {
      song: this.song,
      startedAt: this.startedAt,
      offsetSec: this.offsetSec,
      durationSec: this.durationSec,
      ended: this.ended,
      endedAt: this.endedAt,
      lagSec: this.lagSec,
    }
  }

  reset(): void {
    this.song = null
    this.startedAt = 0
    this.offsetSec = 0
    this.durationSec = 0
    this.ended = false
    this.endedAt = 0
    /* what was learned stays: it belongs to the station, and the station is
       remembered by its address, not by the session */
  }

  /**
   * Work out how late the last announcement was, and remember it.
   *
   * With a known end (the fade-out was heard) this is exact:
   *
   *     L = T_start - (T_end - D)
   *
   * Without one the next announcement is used as the end, which also
   * contains any advertising break — so the result is a lower bound and
   * lands on zero, which is the safe assumption.
   *
   * The measurement is taken once per song: the pieces arrive at different
   * moments (the fade-out, then the length from the lyrics source), and
   * whichever completes the picture first wins.
   */
  private learn(fallbackEnd = 0): void {
    if (!this.song) return
    if (this.learnedToken === this.token) return
    const end = this.endedAt || fallbackEnd
    if (!end) return
    if (this.durationSec <= 0) return
    const start = this.startedAt - this.offsetSec * 1000
    const played = (end - start) / 1000
    if (played <= 0) return
    const measured = clamp(this.durationSec - played, 0, LAG_MAX)
    /* the running average is per station, so one station's habit never
       becomes another's */
    const prev = this.lagByUrl.get(this.song.url) ?? 0
    const lag = prev ? prev + (measured - prev) * LAG_WEIGHT : measured
    this.lagByUrl.set(this.song.url, lag)
    /* the map is a cache, not an archive */
    if (this.lagByUrl.size > LAG_STATIONS) {
      const oldest = this.lagByUrl.keys().next()
      if (!oldest.done) this.lagByUrl.delete(oldest.value)
    }
    this.lagSec = lag
    this.learnedToken = this.token
  }
}
