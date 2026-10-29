/**
 * Capturing the samples on the AUDIO thread.
 *
 * The visualiser's audio was being read out of an analyser on the MAIN
 * thread, sixty times a second. That is fine until the main thread has
 * something else to do: the ticks then arrive late and unevenly, the engine
 * is fed holes in its audio, and the pictures stutter exactly when the
 * listener is doing something else.
 *
 * An AudioWorklet fixes it at the root: the worklet runs on the audio
 * rendering thread, which is never starved by the interface, so the samples
 * are captured whether or not the app is busy. They arrive in batches on the
 * main thread — in order, and with the gaps filled in by the time they get
 * there.
 *
 * The worklet is built from a string and loaded from a blob, so there is no
 * extra file to ship and no path to get wrong in a packaged build.
 */

/* The processor: copy the audio through untouched, and keep a copy of the
   first channel to send to the main thread. */
const WORKLET_SOURCE = `
class MdTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = 2048
    this.buf = new Float32Array(this.size)
    this.n = 0
  }
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (input && input[0]) {
      const ch = input[0]
      /* the audio goes on to the speakers exactly as it arrived */
      if (output && output[0]) output[0].set(ch)
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n >= this.size) {
          this.port.postMessage(this.buf.slice(0))
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('md-tap', MdTapProcessor)
`

let moduleUrl: string | null = null

/** load the processor into a context — once per context, not once per tap */
async function loadModule(ctx: BaseAudioContext): Promise<void> {
  if (moduleUrl) {
    await ctx.audioWorklet.addModule(moduleUrl)
    return
  }
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
  moduleUrl = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(moduleUrl)
  } catch (e) {
    moduleUrl = null
    throw e
  }
}

export interface WorkletTap {
  /** the node, so the caller can hang it off the graph */
  node: AudioWorkletNode
  /** called with each batch of samples, on the main thread */
  onSamples: (samples: Float32Array<ArrayBufferLike>) => void
}

/**
 * Hang a tap off a source node.
 *
 * The tap's own output is muted: the sound has already reached the speakers
 * by way of the source, and a second live path would play it twice. But it
 * HAS to be connected onwards, or the node is never pulled and the worklet
 * never runs.
 */
export async function createWorkletTap(
  ctx: BaseAudioContext,
  source: AudioNode,
  onSamples: (samples: Float32Array<ArrayBufferLike>) => void,
): Promise<WorkletTap> {
  await loadModule(ctx)
  /* the worklet node's constructor wants a full AudioContext; the analyser
     only offers the base one, and on a real page they are the same object */
  const node = new AudioWorkletNode(ctx as AudioContext, 'md-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  node.port.onmessage = (event: MessageEvent) => {
    const data = event.data
    if (data instanceof Float32Array) onSamples(data)
  }
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute)
  mute.connect(ctx.destination)
  return { node, onSamples }
}
