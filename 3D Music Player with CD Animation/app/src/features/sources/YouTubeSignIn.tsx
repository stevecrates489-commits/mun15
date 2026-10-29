/**
 * Signing in to YouTube Music.
 *
 * The flow, as the user sees it:
 *
 * 1. **Sign in.** A browser opens with a profile of its own — the app's,
 *    not the user's everyday one. The browser opens YouTube Music.
 * 2. The user signs in there, the normal way, with their own password.
 *    Nothing is typed on their behalf.
 * 3. **I'm done.** The app asks that browser, over the DevTools Protocol,
 *    for its YouTube cookies, and keeps the session.
 *
 * The browser's everyday profile is never opened, and no credential ever
 * passes through this app.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, LogIn, X } from 'lucide-react'
import {
  youtubeSignInCancel,
  youtubeSignInFinish,
  youtubeSignInStart,
  youtubeSignInStatus,
  youtubeSignOut,
  type SignInStatus,
} from './bridge'

interface Props {
  onClose: () => void
  /** Called when the session changes, so the panel can re-read the
   *  sources. */
  onChanged: () => void
}

export default function YouTubeSignIn({ onClose, onChanged }: Props) {
  const [status, setStatus] = useState<SignInStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await youtubeSignInStatus())
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const start = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await youtubeSignInStart())
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])
  const finish = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await youtubeSignInFinish()
      setStatus(next)
      onChanged()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [onChanged])

  const cancel = useCallback(async () => {
    setBusy(true)
    try {
      setStatus(await youtubeSignInCancel())
      onChanged()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [onChanged])

  const signOut = useCallback(async () => {
    setBusy(true)
    try {
      setStatus(await youtubeSignOut())
      onChanged()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [onChanged])

  return (
    <div className="absolute inset-0 z-[92] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-white/12 bg-black/92 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-white/70">
            YOUTUBE MUSIC
          </h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/15 p-1.5 text-white/50 transition hover:border-white/40 hover:text-white"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ---- signed in ---- */}
        {status?.signedIn && (
          <div className="mb-4 border border-emerald-300/20 bg-emerald-300/5 p-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-emerald-300/70" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[10px] tracking-[0.12em] text-emerald-200/85">
                  {status.accountName || 'SIGNED IN'}
                </div>
                {status.email && (
                  <div className="truncate font-mono text-[8px] tracking-[0.12em] text-white/35">
                    {status.email}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 font-mono text-[8px] leading-relaxed tracking-[0.12em] text-white/45">
              {status.premium === true
                ? 'YOUTUBE MUSIC PREMIUM — THE STREAMS ARE AD-FREE'
                : status.premium === false
                  ? 'NOT PREMIUM — THE STREAMS CARRY ADVERTS. A PREMIUM ACCOUNT PLAYS WITHOUT THEM.'
                  : 'THE PREMIUM STATUS IS NOT KNOWN YET'}
            </div>
            <button
              onClick={() => void signOut()}
              disabled={busy}
              className="mt-3 rounded-full border border-white/20 px-3 py-1 font-mono text-[8px] tracking-[0.2em] text-white/50 transition hover:border-white/50 hover:text-white/80 disabled:opacity-40"
            >
              SIGN OUT
            </button>
          </div>
        )}

        {/* ---- waiting for the sign-in ---- */}
        {status?.waiting && (
          <div className="mb-4 border border-white/12 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-white/50" />
              <span className="font-mono text-[9px] tracking-[0.15em] text-white/70">
                WAITING FOR THE SIGN-IN
              </span>
            </div>
            <p className="font-mono text-[8px] leading-relaxed tracking-[0.1em] text-white/40">
              A BROWSER OPENED WITH A PROFILE OF ITS OWN — THE APP&apos;S, NOT YOUR EVERYDAY ONE.
              SIGN IN TO YOUTUBE MUSIC THERE.
            </p>
            <p className="mt-2 font-mono text-[8px] leading-relaxed tracking-[0.1em] text-amber-200/55">
              THEN CLOSE THE BROWSER WINDOW AND PRESS DONE. THE APP CANNOT READ THE COOKIES
              UNTIL THE BROWSER IS CLOSED — IT HOLDS THE PROFILE LOCKED WHILE IT IS OPEN.
            </p>
            {status.profilePath && (
              <p className="mt-2 break-all font-mono text-[7px] tracking-[0.1em] text-white/25">
                PROFILE: {status.profilePath}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void finish()}
                disabled={busy}
                className="rounded-full border border-white/40 bg-white/10 px-4 py-1.5 font-mono text-[9px] tracking-[0.2em] text-white/80 transition hover:bg-white/20 disabled:opacity-40"
              >
                {busy ? 'WORKING…' : 'I\u2019VE CLOSED IT'}
              </button>
              <button
                onClick={() => void cancel()}
                disabled={busy}
                className="rounded-full border border-white/15 px-4 py-1.5 font-mono text-[9px] tracking-[0.2em] text-white/45 transition hover:border-white/40 hover:text-white/70 disabled:opacity-40"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {/* ---- not signed in ---- */}
        {!status?.signedIn && !status?.waiting && (
          <div className="mb-4 border border-white/12 p-3">
            <p className="font-mono text-[8px] leading-relaxed tracking-[0.1em] text-white/40">
              SIGNING IN LETS THE APP READ YOUR YOUTUBE MUSIC LIBRARY AND YOUR PLAYLISTS, AND
              FETCH THE STREAMS AT YOUR ACCOUNT&apos;S QUALITY. A PREMIUM ACCOUNT&apos;S STREAMS CARRY
              NO ADVERTS.
            </p>
            <p className="mt-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
              YOU WILL BE TAKEN TO A BROWSER TO SIGN IN. YOUR PASSWORD IS NEVER HANDLED BY THIS APP.
              THE BROWSER GETS A PROFILE OF ITS OWN, AND THE APP READS THE YOUTUBE COOKIES FROM IT
              AFTERWARDS — YOUR EVERYDAY BROWSER PROFILE IS NEVER OPENED.
            </p>
            <button
              onClick={() => void start()}
              disabled={busy}
              className="mt-3 flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-4 py-1.5 font-mono text-[9px] tracking-[0.2em] text-white/80 transition hover:bg-white/20 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
              SIGN IN
            </button>
          </div>
        )}

        {error && (
          <p className="mb-3 font-mono text-[8px] leading-relaxed tracking-[0.12em] text-amber-300/70">
            {error}
          </p>
        )}

        {/* ---- the legal note, always visible ---- */}
        <div className="border border-amber-300/15 bg-amber-300/[0.03] p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <ExternalLink className="h-3 w-3 text-amber-200/50" />
            <span className="font-mono text-[8px] tracking-[0.2em] text-amber-200/60">
              WHAT THIS DOES
            </span>
          </div>
          <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-amber-200/40">
            THIS SPEAKS YOUTUBE&apos;S UNDOCUMENTED API, WHICH THEIR DEVELOPER POLICIES FORBID
            (III.D.7), AND WHICH FORBIDS DOWNLOADING THEIR AUDIO (III.E.1). IT IS YOUR ACCOUNT AND
            YOUR CALL. IT DOES NOT WORK AROUND DRM, AND IT DOES NOT TOUCH YOUR EVERYDAY BROWSER.
          </p>
        </div>
      </div>
    </div>
  )
}
