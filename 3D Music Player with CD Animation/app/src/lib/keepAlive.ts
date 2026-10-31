/* The pause keep-alive.
 *
 * Windows audio endpoints power down when nothing renders. A media element
 * left paused keeps its pipeline, but the SHARED output stream closes once
 * nothing has been audible for a while — and on some driver stacks waking
 * the endpoint again costs seconds. The report: every track, every time,
 * about 5-6s between the play click and the first sample after a minute
 * paused.
 *
 * So the render path never fully stops, which is the browser equivalent of
 * foobar2000's silence-writing output (the device never sees a stop; resume
 * is just more samples): while nothing plays, this loops one second of true
 * zero samples through the mixer and the endpoint stays open.
 *
 * The buffer is digital silence AND the element's own volume is a
 * hundredth — inaudible by both construction and arithmetic. It is a plain
 * element by the engine's own rule: never captured, never routed through
 * the graph, invisible to every analyser (the deck's capture stream is
 * untouched), and it carries no media-session metadata, so the OS flyout
 * keeps answering to the deck.
 */

let el: HTMLAudioElement | null = null

export function startKeepAlive(): void {
  if (el) {
    if (el.paused) void el.play().catch(() => {
      /* no gesture behind this attempt — the next interaction retries */
    })
    return
  }
  /* 1s of 8kHz mono 16-bit zero samples, wrapped in a canonical WAV header
     by hand — no asset, no fetch, nothing to load wrong. */
  const samples = 8000
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) /* PCM */
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true) /* mono */
  view.setUint32(24, 8000, true) /* sample rate */
  view.setUint32(28, 16000, true) /* byte rate */
  view.setUint16(32, 2, true) /* block align */
  view.setUint16(34, 16, true) /* bits */
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  /* everything from byte 44 on is already zero — the silence itself */

  el = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })))
  el.loop = true
  /* above zero so the element renders; one percent of silence is silence */
  el.volume = 0.01
  void el.play().catch(() => {
    /* autoplay policy before the first gesture — the wake listener retries */
  })
}

export function stopKeepAlive(): void {
  el?.pause()
}

/** For diagnostics and the verification harness. */
export function keepAliveElement(): HTMLAudioElement | null {
  return el
}
