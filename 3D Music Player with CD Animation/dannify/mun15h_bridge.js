/* The player's half of the bridge into this extension's page.
 *
 * This file belongs to the player (it sits beside player_bridge.py, not in
 * Dannify's own interface), and it is served at /__mun15h/bridge.js and
 * injected into every page this server hands out — see the injection in
 * player_bridge.py. It used to be edited into frontend/dist/index.html,
 * which meant every new Dannify release silently lost it: replacing that
 * folder replaced the only copy. Keeping it here means a newer Dannify is
 * a folder swap with nothing to re-apply.
 *
 * Two jobs, both about living inside the player's window:
 *
 *   1. Ctrl+R restarts THIS extension, never the player around it. The
 *      webview's native shortcut would reload the whole app — boot intro,
 *      deck, queue and all — so while focus is in the frame the key is
 *      cancelled here and only this document reloads.
 *
 *   2. One thing plays at a time. The player cannot reach across the frame's
 *      origin, so this reports play/pause up to the player and silences every
 *      media element here when the player asks. (The other half lives in
 *      app/src/features/dannify/DannifyWindow.tsx.)
 *
 * Kept as plain, dependency-free ES5-era JavaScript on purpose: it runs
 * before Dannify's own bundle, whatever that bundle is built with, and it
 * must never be the reason a page fails to load.
 */

/* 1 — Ctrl+R reloads the extension only.
 *
 * With focus inside the extension the key lands in THIS document, so
 * cancelling it here stops the webview from reloading the whole app, and
 * reloading this frame is exactly the refresh the shortcut is for.
 */
window.addEventListener(
  'keydown',
  function (e) {
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')
    ) {
      e.preventDefault()
      e.stopPropagation()
      location.reload()
    }
  },
  true
)

/* 2 — the audio bridge.
 *
 * The mark is what both halves match on, so a stray postMessage from some
 * other page in the webview is ignored by the player, and a message not
 * meant for the player is ignored here.
 */
;(function () {
  var MARK = 'mun15h-dannify-bridge'

  /* Media elements that have played in this page. A player may keep its
     element detached from the document — nothing else can see it then, not
     even a query — so what has played is remembered here, and the pause
     below covers both the remembered and the attached. */
  var played = []

  function isMedia(t) {
    return !!t && (t.tagName === 'AUDIO' || t.tagName === 'VIDEO')
  }

  function report(playing) {
    // only when embedded: on its own this page has no one to tell
    if (window.parent === window) return
    try {
      window.parent.postMessage({ mark: MARK, type: 'audio', playing: playing }, '*')
    } catch (e) {}
  }

  // Capture phase: these fire for every media element in this document
  // whenever it plays or pauses, whatever rendered it — play and pause do
  // not bubble, so capture is the only way to see them up here.
  document.addEventListener(
    'play',
    function (e) {
      if (!isMedia(e.target)) return
      if (played.indexOf(e.target) === -1) played.push(e.target)
      report(true)
    },
    true
  )

  document.addEventListener(
    'pause',
    function (e) {
      if (isMedia(e.target)) report(false)
    },
    true
  )

  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || d.mark !== MARK || d.type !== 'pause') return
    var list = document.querySelectorAll('audio, video')
    var all = played.slice()
    for (var i = 0; i < list.length; i++) {
      if (all.indexOf(list[i]) === -1) all.push(list[i])
    }
    for (var j = 0; j < all.length; j++) {
      try {
        all[j].pause()
      } catch (err) {}
    }
  })
})()
