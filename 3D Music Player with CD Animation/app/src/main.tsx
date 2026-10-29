import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { bootReady } from './lib/bootGate'
import { installErrorNets, reportFatal } from './lib/fatalError'
import { noteBootAttempt, bootSettled } from './lib/safeMode'

declare global {
  interface Window {
    Boot?: { waitFor: (p: Promise<void>) => void }
  }
}

/* the inline boot script in index.html exposes window.Boot — hold its exit
   until React is mounted so the player never flashes behind the animation */
window.Boot?.waitFor(bootReady)

/* every uncaught error is painted on the screen: a blank window is the
   worst failure there is, because it looks like the app is working */
installErrorNets()

/* count this launch BEFORE anything renders: one that dies never reaches
   bootSettled, and three in a row open in safe mode (the live wallpaper
   parked, a banner saying so) instead of dying the same way again */
noteBootAttempt()

/**
 * A render error takes the whole tree down. React catches it, and without
 * something in the way the window is simply blank — so the boundary says
 * what happened instead.
 */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    const stack = (info as { componentStack?: string } | undefined)?.componentStack ?? ''
    reportFatal(error, 'THE APP HIT A RENDER ERROR')
    try {
      console.error('render error', error, stack)
    } catch {
      /* the console is gone too */
    }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Boundary>
  </StrictMode>,
)

/* the app is up: if it is still up a few seconds from now, this launch was
   a good one and the counter goes back to zero */
bootSettled()
