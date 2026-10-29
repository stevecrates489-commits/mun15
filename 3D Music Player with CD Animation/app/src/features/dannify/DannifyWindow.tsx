/**
 * The Dannify extension, on screen.
 *
 * Dannify is its own app: its own interface, its own player, its own
 * queue and its own library. This is the window it runs in, and nothing
 * more — no track from here reaches the player's playlist, and no track
 * from the player's library reaches it. The two are separate on purpose.
 *
 * The extension is served from loopback by the folder beside the app
 * (`dannify/`), so replacing that folder updates it. The bar asks the
 * extension which version it is and which names it still exposes, and says
 * so when an update has moved something underneath it.
 *
 * The one thing it does need help with is signing in. Dannify's own sign-in
 * belongs to its desktop shell, and in a browser it refuses: "Signing in
 * needs the desktop app." The player *is* one, so the bar above carries the
 * button — pressing it opens your own browser on YouTube Music's sign-in
 * page, waits while you sign in, and hands the session to the extension
 * (see `src-tauri/src/dannify.rs` and `dannify/browser_signin.py`). A
 * machine without a browser gets the player's own sign-in window instead.
 * Once signed in, likes, your library and downloads are all Dannify's own.
 *
 * Closing the window unmounts the frame, which stops the extension's
 * player — one thing plays at a time.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Loader2, LogIn, X } from 'lucide-react'
import {
  dannifyAccount,
  dannifyOpen,
  dannifySignIn,
  dannifyVersion,
  type DannifyAccount,
  type DannifyReport,
} from './bridge'

interface Props {
  onClose: () => void
  /** Called when the extension's own player starts (true) or stops (false),
   *  so the player around the frame can yield the output — one thing plays
   *  at a time, whichever window it lives in. */
  onAudioChange?: (playing: boolean) => void
}

/** The player's half of that bridge, handed to whoever renders the window. */
export interface DannifyHandle {
  /** Silence the extension's own player, whatever it is doing. */
  pause: () => void
}

/** What the frame page's own bridge speaks — see frontend/dist/index.html. */
const BRIDGE_MARK = 'mun15h-dannify-bridge'
const FRAME_ORIGIN = 'http://127.0.0.1:8765'

function DannifyWindow({ onClose, onAudioChange }: Props, ref: Ref<DannifyHandle>) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frameReady, setFrameReady] = useState(false)
  /* Bumped after a sign-in: the frame reloads, and comes back signed in. */
  const [frameKey, setFrameKey] = useState(0)

  const [account, setAccount] = useState<DannifyAccount | null>(null)
  /* what the extension says about itself — version, and the names it still
     exposes. null until it answers, and for an extension old enough not to
     answer at all. */
  const [report, setReport] = useState<DannifyReport | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const aliveRef = useRef(true)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  /** Ask the frame to fall silent — the deck taking the output does this so
   *  only one thing plays. Safe before the frame has loaded: nothing in it
   *  can be playing yet. */
  const pauseFrame = useCallback(() => {
    const target = frameRef.current?.contentWindow
    if (!target) return
    try {
      target.postMessage({ mark: BRIDGE_MARK, type: 'pause' }, FRAME_ORIGIN)
    } catch {
      /* the frame went away between the check and the send */
    }
  }, [])

  useImperativeHandle(ref, () => ({ pause: pauseFrame }), [pauseFrame])

  /* When the extension's own player starts, tell the caller — it stops the
     deck and silences the stream, the same way the deck and the station
     already silence each other. Only messages from THIS frame are believed:
     any other page in the webview could post to this window. */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { mark?: string; type?: string; playing?: boolean } | null
      if (!data || data.mark !== BRIDGE_MARK || data.type !== 'audio') return
      onAudioChange?.(data.playing === true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onAudioChange])

  useEffect(() => {
    aliveRef.current = true
    void dannifyOpen()
      .then((found) => {
        if (aliveRef.current) setUrl(found)
      })
      .catch((e: unknown) => {
        if (aliveRef.current) setError(String(e))
      })
    return () => {
      aliveRef.current = false
    }
  }, [])

  /* who it is signed in as, and what it is, once the extension is up */
  useEffect(() => {
    if (!url) return
    let live = true
    void dannifyAccount()
      .then((found) => {
        if (live) setAccount(found)
      })
      .catch(() => {
        /* not an error worth showing: the extension may still be starting */
      })
    /* The version and the contract. A copy that has no report route is an
       older one — nothing wrong with it, and nothing to show. */
    void dannifyVersion()
      .then((found) => {
        if (live) setReport(found)
      })
      .catch(() => {
        if (live) setReport(null)
      })
    return () => {
      live = false
    }
  }, [url, frameKey])

  /* Esc closes the window, the same way the app's other panels do */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /* Ctrl+R restarts THIS window, never the player around it. The webview's
     native shortcut would reload the whole app — boot intro, deck, queue and
     all — so while the extension is open the key is caught here (focus can
     still be on the chrome around the frame) and only the iframe is remounted.
     Keys typed inside the frame never reach this document; the same rule is
     enforced there too, in the extension's own index.html. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyR') {
        e.preventDefault()
        e.stopPropagation()
        setFrameReady(false)
        setFrameKey((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const close = useCallback(() => onClose(), [onClose])

  const startSignIn = useCallback(() => {
    if (signingIn) return
    setSigningIn(true)
    setNotice(null)
    /* signing in is the player's own business: the extension waits
       silently, whatever it was doing */
    pauseFrame()
    void dannifySignIn()
      .then((result) => {
        if (!aliveRef.current) return
        setAccount(result)
        if (result.signed_in) {
          setNotice(null)
          /* the extension reads its account once, on boot: reload it */
          setFrameReady(false)
          setFrameKey((n) => n + 1)
        } else if (result.cancelled) {
          setNotice(null)
        } else if (result.timeout) {
          setNotice('No sign-in happened in time. Try again when ready.')
        } else {
          setNotice(result.error ?? 'That did not sign in.')
        }
      })
      .catch((e: unknown) => {
        if (aliveRef.current) setNotice(String(e))
      })
      .finally(() => {
        if (aliveRef.current) setSigningIn(false)
      })
  }, [signingIn, pauseFrame])

  const who = account?.profile?.name || ''
  const signedIn = Boolean(account?.signed_in)
  /* An update that moved something the player reaches for: the extension
     names each one, and the bar says so rather than letting a dead button
     be discovered later. */
  const missing = report?.missing ?? []
  const broken = missing.length > 0

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#0b0b0d]">
      {/* a thin chrome of the player's own, so it reads as a window of the
          app rather than a stray copy of something else */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-white/10 bg-black/80 px-3">
        <span className="font-mono text-[9px] tracking-[0.28em] text-white/45">
          DANNIFY{report?.dannify ? ` ${report.dannify}` : ''}
        </span>
        <span
          className={`h-1 w-1 rounded-full ${
            broken ? 'bg-amber-400' : signedIn ? 'bg-emerald-400' : 'bg-white/20'
          }`}
          title={
            broken
              ? missing.map((item) => `${item.check}: ${item.missing}`).join('\n')
              : signedIn
                ? `Signed in as ${who}`
                : 'Not signed in'
          }
        />

        {/* The close button lives at this end, next to the name, because the
            far end of a bar is the first thing a too-wide window loses. */}
        <button
          onClick={close}
          aria-label="Close Dannify"
          title="Close"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/15 text-white/50 transition hover:border-white/45 hover:text-white"
        >
          <X size={11} />
        </button>

        {/* The button sits here, at the left, beside the name: it is the one
            thing this window has to offer that Dannify's own interface cannot
            do, so it does not belong at the far end of a bar. */}
        {!signedIn && url && (
          <button
            onClick={startSignIn}
            disabled={signingIn}
            title="Sign in to YouTube Music"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/40 px-2.5 py-1 font-mono text-[8px] tracking-[0.16em] text-emerald-300/90 transition hover:border-emerald-300 hover:text-emerald-200 disabled:opacity-50"
          >
            {signingIn ? <Loader2 size={10} className="animate-spin" /> : <LogIn size={10} />}
            {signingIn ? 'SIGN IN IN YOUR BROWSER…' : 'SIGN IN TO YOUTUBE MUSIC'}
          </button>
        )}

        <span
          className={`min-w-0 flex-1 truncate font-mono text-[8px] tracking-[0.18em] ${
            broken ? 'text-amber-300/80' : 'text-white/25'
          }`}
          title={broken ? missing.map((item) => `${item.check} — ${item.for}`).join('\n') : undefined}
        >
          {notice
            ? notice
            : broken
              ? `${missing.length} OF ${report?.checked ?? missing.length} NAMES THE PLAYER USES ARE MISSING · SEE THE EXTENSION'S LOG`
              : signedIn
                ? `SIGNED IN AS ${who.toUpperCase() || 'YOUTUBE MUSIC'} · YOUR LIKES AND DOWNLOADS ARE LIVE`
                : 'THE ONLINE EXTENSION · ITS OWN PLAYER AND LIBRARY'}
        </span>

      </div>

      <div className="relative min-h-0 flex-1">
        {!url && !error && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-3 text-white/45">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono text-[9px] tracking-[0.22em]">STARTING DANNIFY…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="max-w-md border border-red-400/25 bg-red-500/5 p-5">
              <div className="mb-2 font-mono text-[9px] tracking-[0.24em] text-red-300/80">
                THE EXTENSION DID NOT START
              </div>
              <p className="text-[12px] leading-relaxed text-white/60">{error}</p>
              <p className="mt-3 text-[11px] leading-relaxed text-white/35">
                It lives in the <span className="font-mono">dannify</span> folder beside the
                player. Its first launch installs what it needs, which takes a minute.
              </p>
            </div>
          </div>
        )}

        {url && (
          <>
            {!frameReady && (
              <div className="absolute inset-0 grid place-items-center bg-[#0b0b0d]">
                <div className="flex items-center gap-3 text-white/45">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-mono text-[9px] tracking-[0.22em]">LOADING DANNIFY…</span>
                </div>
              </div>
            )}
            <iframe
              key={frameKey}
              ref={frameRef}
              src={url}
              title="Dannify"
              onLoad={() => setFrameReady(true)}
              allow="autoplay; clipboard-write"
              className="h-full w-full border-0"
            />
          </>
        )}
      </div>
    </div>
  )
}

export default forwardRef(DannifyWindow)
