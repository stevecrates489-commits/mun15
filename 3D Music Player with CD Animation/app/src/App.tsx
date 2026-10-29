import { useEffect } from 'react'
import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import { signalBootReady } from './lib/bootGate'
import { startAdaptiveQuality } from './lib/adaptiveQuality'

export default function App() {
  useEffect(() => {
    signalBootReady('mount')
    /* the glass-quality switch has to be in force before the first paint,
       not only once the wallpaper panel has been opened once */
    document.documentElement.dataset.glass = localStorage.getItem('md-glass') === 'off' ? 'off' : 'on'
    /* frames decide how many pixels every canvas is allowed to paint */
    startAdaptiveQuality()
  }, [])
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  )
}
