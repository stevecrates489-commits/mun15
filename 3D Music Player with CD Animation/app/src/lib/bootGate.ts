/* Boot gate — the fake boot in index.html holds its exit until the app is
   genuinely ready to BE REVEALED: React mounted, disc art decoded, fonts
   swapped, audio graph built, wallpaper media showing its first frame.
   Subsystems call signalBootReady(key); once every key has checked in the
   gate waits TWO real frames (commit -> paint -> composite) so the shutters
   never open onto a black first paint. The boot shows SYNCING LIBRARY while
   it waits. A 15s safety valve releases everything regardless. */
const REQUIRED = new Set(['mount', 'assets', 'audio', 'wallpaper'])
let release: (() => void) | undefined
let released = false

/* A subsystem that waits on the network, on fonts or on IndexedDB can stall
   WITHOUT failing — nothing rejects, the promise simply never settles, and
   the intro sits on SYNCING LIBRARY forever. Each key therefore gets its own
   deadline: the gate opens regardless and the console says which one was
   late, which is the difference between "the app is broken" and "the app is
   up, and its wallpaper store never answered". */
const KEY_DEADLINE_MS = 7000
const deadlines = new Map<string, number>()

export const bootReady = new Promise<void>((res) => {
  release = res
})

const tryRelease = () => {
  if (released || REQUIRED.size) return
  released = true
  for (const id of deadlines.values()) clearTimeout(id)
  deadlines.clear()
  /* two rAFs = at least one full composited frame of the finished player
     happened after the last signal — the reveal lands on a static, warm UI */
  requestAnimationFrame(() => requestAnimationFrame(() => release?.()))
}

export const signalBootReady = (key: string) => {
  const id = deadlines.get(key)
  if (id !== undefined) {
    clearTimeout(id)
    deadlines.delete(key)
  }
  REQUIRED.delete(key)
  tryRelease()
}

for (const key of REQUIRED) {
  const id = window.setTimeout(() => {
    deadlines.delete(key)
    if (!REQUIRED.has(key)) return
    console.warn(`[boot] "${key}" never reported ready — opening the gate without it`)
    REQUIRED.delete(key)
    tryRelease()
  }, KEY_DEADLINE_MS)
  deadlines.set(key, id)
}

/* Release the gate whatever happens — used when the app has failed and the
   error message needs the screen more than the intro does. */
export const releaseBoot = () => {
  if (released) return
  released = true
  release?.()
}

/* safety valve — a failed subsystem can never trap the user behind the boot */
setTimeout(() => {
  if (released) return
  released = true
  release?.()
}, 15000)
