/**
 * Safe mode: if the app cannot get through a boot, stop it from trying the
 * heaviest thing it does.
 *
 * A crash loop looks like a dead app — the window opens, something in the
 * live layers dies, and the user is left restarting. So every launch counts
 * itself BEFORE React renders; a launch that fails never reaches the point
 * where the count is cleared. Three launches in a row without a healthy
 * start put the player in safe mode: the live wallpaper is put back to the
 * plain theme (the wallpaper pipeline — decoding, converting, governor and
 * all — is by far the biggest thing that can fail at boot), and a banner
 * says so, with the way out.
 *
 * Safe mode is not permanent: it clears itself after one healthy boot, so
 * turning a setting off once is the whole recovery.
 */

const ATTEMPTS = 'md-boot-attempts'
const SAFE = 'md-safe-mode'
/* how long the app has to be up before its launch counts as healthy */
const SETTLED_MS = 6000

/* whether THIS session is in safe mode — kept in memory so the banner and
   the wallpaper keep telling the same story even after the counters clear */
let sessionSafe = false
/* a fatal error during the launch means this launch does not count as
   healthy — the counter keeps its increment and bootSettled does nothing */
let launchFailed = false

/** reportFatal calls this: this launch died, so do not clear the counter. */
export function markBootFailed(): void {
  launchFailed = true
}

/** Read-only: is this session running in safe mode? */
export function safeMode(): boolean {
  return sessionSafe
}

/**
 * Called once, before the app renders. Returns whether safe mode is on.
 * Must not throw: it runs on the boot path.
 */
export function noteBootAttempt(): boolean {
  try {
    const already = localStorage.getItem(SAFE) === '1'
    const n = Number(localStorage.getItem(ATTEMPTS) ?? '0') + 1
    if (already) {
      sessionSafe = true
      return true
    }
    if (n >= 3) {
      localStorage.setItem(SAFE, '1')
      localStorage.setItem(ATTEMPTS, '0')
      /* the live wallpaper is what a crash-looping boot most likely trips
         over: park it so the next launch has a chance to get up */
      if (localStorage.getItem('md-theme') !== 'black') {
        localStorage.setItem('md-theme-when-safe', localStorage.getItem('md-theme') ?? 'black')
        localStorage.setItem('md-theme', 'black')
      }
      sessionSafe = true
      return true
    }
    localStorage.setItem(ATTEMPTS, String(n))
    return false
  } catch {
    return false
  }
}

/**
 * Called once the app has been up long enough to call it healthy: the next
 * launch starts from zero again.
 */
export function bootSettled(): void {
  window.setTimeout(() => {
    if (launchFailed) return
    try {
      localStorage.setItem(ATTEMPTS, '0')
      if (localStorage.getItem(SAFE) === '1') {
        localStorage.removeItem(SAFE)
        const before = localStorage.getItem('md-theme-when-safe')
        if (before) {
          localStorage.setItem('md-theme', before)
          localStorage.removeItem('md-theme-when-safe')
        }
      }
    } catch {
      /* private mode — the counters simply do not persist */
    }
  }, SETTLED_MS)
}
