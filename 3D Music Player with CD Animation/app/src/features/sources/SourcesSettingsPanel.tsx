/**
 * The sources' settings, and their state.
 *
 * Two jobs:
 *
 * - **Configure.** The Jamendo client id, and whether to allow the YouTube
 *   adapter. The YouTube one is a switch with a warning attached, because
 *   it works through an API YouTube's policies forbid and the user has to
 *   be the one who decides.
 * - **Report.** Which source is working, which is standing down, and why.
 *   A system that fails over silently is impossible to trust.
 */

import YouTubeSignIn from './YouTubeSignIn'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, LogIn, TriangleAlert, X } from 'lucide-react'
import {
  BROWSER_CHOICES,
  STREAM_MODES,
  sourcesHealthCheck,
  sourcesSetSettings,
  sourcesStatus,
  spotifySignInFinish,
  spotifySignInStart,
  spotifySignInStatus,
  spotifySignOut,
  youtubeSignInStatus,
  type SignInStatus,
  type SourceSettings,
  type SourcesStatus,
} from './bridge'

interface Props {
  onClose: () => void
  /** Called when the settings change, so the panel can re-read them. */
  onChanged: () => void
}

const HEALTH_LABEL: Record<string, string> = {
  unknown: 'NOT CHECKED',
  healthy: 'WORKING',
  degraded: 'WORKING, SLOW',
  unhealthy: 'NOT WORKING',
}

export default function SourcesSettingsPanel({ onClose, onChanged }: Props) {
  const [status, setStatus] = useState<SourcesStatus | null>(null)
  const [jamendoKey, setJamendoKey] = useState('')
  const [allowYoutube, setAllowYoutube] = useState(false)
  const [ytDlpPath, setYtDlpPath] = useState('')
  const [ytDlpArgs, setYtDlpArgs] = useState('')
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<SignInStatus | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [spotifyClientId, setSpotifyClientId] = useState('')
  const [spotifySignedIn, setSpotifySignedIn] = useState(false)
  const [signInBrowser, setSignInBrowser] = useState('automatic')
  const [streamMode, setStreamMode] = useState('fast')
  /* The last settings that were read, so a change can be saved without
   * having to fetch them again. */
  const settingsRef = useRef<SourceSettings | null>(null)

  const load = useCallback(async () => {
    try {
      const current = await sourcesStatus()
      setStatus(current)
      /* and the YouTube sign-in, which is a separate thing. */
      try {
        setSignIn(await youtubeSignInStatus())
      } catch {
        setSignIn(null)
      }
      settingsRef.current = current.settings
      setSignInBrowser(current.settings.signInBrowser ?? 'automatic')
      setStreamMode(current.settings.streamMode ?? 'fast')
      setSpotifyClientId(current.settings.spotifyClientId ?? '')
      try {
        setSpotifySignedIn(await spotifySignInStatus())
      } catch {
        setSpotifySignedIn(false)
      }
      setJamendoKey(current.settings.jamendoClientId ?? '')
      setAllowYoutube(current.settings.allowYoutube)
      setYtDlpPath(current.settings.ytDlpPath ?? '')
      setYtDlpArgs((current.settings.ytDlpArgs ?? []).join(' '))
    } catch (e) {
      setNote(String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    setSaving(true)
    setNote(null)
    try {
      const settings: SourceSettings = {
        jamendoClientId: jamendoKey.trim() || null,
        allowYoutube,
        spotifyClientId: spotifyClientId.trim() || null,
        signInBrowser,
        streamMode,
        ytDlpPath: ytDlpPath.trim() || null,
        /* Split on whitespace: the arguments are separate words. */
        ytDlpArgs: ytDlpArgs.trim() ? ytDlpArgs.trim().split(/\s+/) : [],
      }
      const next = await sourcesSetSettings(settings)
      setStatus(next)
      setNote('SAVED')
      onChanged()
    } catch (e) {
      setNote(String(e))
    } finally {
      setSaving(false)
    }
  }, [jamendoKey, allowYoutube, spotifyClientId, signInBrowser, streamMode, ytDlpPath, ytDlpArgs, onChanged])

  const openSignIn = useCallback(() => setSignInOpen(true), [])

  /* The Spotify sign-in: the system browser, and then the code comes
     back on the loopback port. */
  const startSpotify = useCallback(async () => {
    setSaving(true)
    setNote(null)
    try {
      await spotifySignInStart()
      /* Give the browser a moment, then ask for the token. */
      await new Promise((r) => setTimeout(r, 1500))
      await spotifySignInFinish()
      setSpotifySignedIn(true)
      setNote("SIGNED IN")
      /* The client id has to be saved, or the next launch forgets it. */
      const settings = settingsRef.current
      if (settings) {
        await sourcesSetSettings({ ...settings, spotifyClientId: spotifyClientId || null })
        settingsRef.current = { ...settings, spotifyClientId: spotifyClientId || null }
      }
    } catch (e) {
      setNote(String(e))
    } finally {
      setSaving(false)
    }
  }, [spotifyClientId])

  const signOutSpotify = useCallback(async () => {
    setSaving(true)
    try {
      await spotifySignOut()
      setSpotifySignedIn(false)
    } catch (e) {
      setNote(String(e))
    } finally {
      setSaving(false)
    }
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    setNote(null)
    try {
      await sourcesHealthCheck()
      await load()
      setNote('CHECKED')
    } catch (e) {
      setNote(String(e))
    } finally {
      setChecking(false)
    }
  }, [load])

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto border border-white/12 bg-black/90 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-white/70">ONLINE SOURCES</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/15 p-1.5 text-white/50 transition hover:border-white/40 hover:text-white"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* the state of each source */}
        <div className="mb-5 border border-white/10">
          <div className="border-b border-white/10 px-3 py-1.5 font-mono text-[8px] tracking-[0.2em] text-white/35">
            THE SOURCES
          </div>
          {(status?.sources ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 border-b border-white/5 px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] tracking-[0.15em] text-white/75">
                  {s.displayName.toUpperCase()}
                </div>
                <div className="truncate font-mono text-[7px] tracking-[0.12em] text-white/30">
                  {s.configured
                    ? `${HEALTH_LABEL[s.health] ?? s.health} · ${s.successes}/${s.attempts} OK${
                        s.quarantinedUntil ? ' · STANDING DOWN' : ''
                      }${s.lastKnownGood ? ' · LAST WORKED' : ''}`
                    : s.notConfiguredReason ?? 'NOT SET UP'}
                </div>
              </div>
              {s.lastKnownGood && <Check className="h-3 w-3 shrink-0 text-emerald-300/60" />}
            </div>
          ))}
          {!status && <div className="px-3 py-3 font-mono text-[8px] text-white/25">LOADING…</div>}
        </div>

        {/* jamendo */}
        <label className="mb-4 block">
          <span className="mb-1 block font-mono text-[8px] tracking-[0.2em] text-white/35">
            JAMENDO CLIENT ID
          </span>
          <input
            value={jamendoKey}
            onChange={(e) => setJamendoKey(e.target.value)}
            placeholder="PASTE YOUR FREE CLIENT ID"
            className="w-full border border-white/12 bg-white/5 px-2 py-1.5 font-mono text-[9px] text-white/80 outline-none transition placeholder:text-white/20 focus:border-white/40"
          />
          <span className="mt-1 block font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
            FREE, FROM DEVPORTAL.JAMENDO.COM. THE WHOLE CATALOGUE IS CREATIVE COMMONS — READ THE
            LICENCE ON EACH TRACK, BECAUSE NOT ALL OF THEM ARE THE PERMISSIVE KIND.
          </span>
        </label>

        {/* spotify */}
        <div className="mb-4 border border-white/12 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-mono text-[8px] tracking-[0.2em] text-white/40">SPOTIFY</span>
            {spotifySignedIn ? (
              <span className="flex items-center gap-1 font-mono text-[7px] tracking-[0.15em] text-emerald-300/60">
                <Check className="h-2.5 w-2.5" /> SIGNED IN
              </span>
            ) : null}
          </div>
          <input
            value={spotifyClientId}
            onChange={(e) => setSpotifyClientId(e.target.value)}
            placeholder="SPOTIFY CLIENT ID (FROM DEVELOPER.SPOTIFY.COM)"
            className="w-full border border-white/12 bg-white/5 px-2 py-1.5 font-mono text-[9px] text-white/80 outline-none transition placeholder:text-white/20 focus:border-white/40"
          />
          <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
            SPOTIFY DOES NOT HAND THESE OUT TO ANYONE WHO ASKS — YOU MAKE AN APP AT
            DEVELOPER.SPOTIFY.COM AND PUT ITS ID HERE.
            <br />
            <br />
            SPOTIFY&apos;S API IS A CATALOGUE, NOT A SOURCE OF AUDIO. IT WILL FIND AND LIST
            YOUR MUSIC, BUT PLAYING IT HERE NEEDS SPOTIFY&apos;S OWN PLAYER SDK, WHICH WANTS A
            PREMIUM ACCOUNT AND PLAYS THROUGH SPOTIFY RATHER THAN THROUGH THIS APP.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void startSpotify()}
              disabled={saving || spotifySignedIn}
              className="rounded-full border border-white/30 px-3 py-1 font-mono text-[8px] tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white disabled:opacity-40"
            >
              {spotifySignedIn ? 'SIGNED IN' : 'SIGN IN'}
            </button>
            {spotifySignedIn && (
              <button
                onClick={() => void signOutSpotify()}
                disabled={saving}
                className="rounded-full border border-white/15 px-3 py-1 font-mono text-[8px] tracking-[0.2em] text-white/45 transition hover:border-white/40 hover:text-white/70 disabled:opacity-40"
              >
                SIGN OUT
              </button>
            )}
          </div>
        </div>

        {/* youtube */}
        <div className="mb-4 border border-amber-300/20 bg-amber-300/5 p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={allowYoutube}
              onChange={(e) => setAllowYoutube(e.target.checked)}
              className="mt-0.5 h-3 w-3 shrink-0 accent-amber-300"
            />
            <span className="font-mono text-[9px] tracking-[0.15em] text-amber-200/80">
              ALLOW YOUTUBE (OPT-IN)
            </span>
          </label>
          <p className="mt-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-amber-200/45">
            THIS ADAPTER WORKS THROUGH YOUTUBE&apos;S UNDOCUMENTED API. THEIR DEVELOPER POLICIES
            FORBID IT (III.D.7) AND FORBID DOWNLOADING THEIR AUDIO (III.E.1). IT IS OFF UNTIL YOU
            TURN IT ON, AND THE DECISION IS YOURS.
            <br />
            <br />
            IT NEEDS <span className="text-amber-200/70">yt-dlp</span> ON YOUR PATH OR SET BELOW. IT
            DOES NOT TOUCH YOUR BROWSER&apos;S COOKIES UNLESS YOU TELL IT TO, AND IT DOES NOT
            WORK AROUND DRM.
          </p>

          {/* the sign-in, once YouTube is allowed */}
          {allowYoutube && (
            <div className="mt-3 border border-white/12 bg-black/25 p-2.5">
              {signIn?.signedIn ? (
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300/70" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[8px] tracking-[0.12em] text-white/75">
                      {signIn.accountName || 'SIGNED IN'}
                    </div>
                    <div className="font-mono text-[7px] tracking-[0.1em] text-white/35">
                      {signIn.premium === true
                        ? 'PREMIUM — AD-FREE STREAMS'
                        : signIn.premium === false
                          ? 'NOT PREMIUM'
                          : 'PREMIUM STATUS UNKNOWN'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  <span className="flex-1 font-mono text-[8px] tracking-[0.12em] text-white/50">
                    {signIn?.waiting
                      ? 'WAITING FOR THE SIGN-IN IN THE BROWSER'
                      : 'NOT SIGNED IN — YOUR LIBRARY AND PLAYLISTS ARE NOT AVAILABLE YET'}
                  </span>
                  <button
                    onClick={() => void openSignIn()}
                    className="rounded-full border border-white/30 px-3 py-1 font-mono text-[8px] tracking-[0.18em] text-white/70 transition hover:border-white/60 hover:text-white"
                  >
                    SIGN IN
                  </button>
                </div>
              )}

              {/* which browser it opens */}
          <div className="mt-2.5">
                <div className="mb-1 font-mono text-[7px] tracking-[0.2em] text-white/30">
                  THE BROWSER IT OPENS
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BROWSER_CHOICES.map((choice) => (
                    <button
                      key={choice.id}
                      onClick={() => setSignInBrowser(choice.id)}
                      className={`rounded-full border px-2.5 py-1 font-mono text-[7px] tracking-[0.18em] transition ${
                        signInBrowser === choice.id
                          ? 'border-white/50 bg-white/10 text-white/85'
                          : 'border-white/12 text-white/40 hover:border-white/30 hover:text-white/70'
                      }`}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
                  BRAVE IS LOOKED FOR FIRST. A BROWSER THAT IS NOT INSTALLED IS NOT SWAPPED FOR
                  ANOTHER ONE — THE APP SAYS SO RATHER THAN OPENING THE WRONG BROWSER.
                </p>
              </div>

              {/* how the streams are resolved */}
              <div className="mt-2.5">
                <div className="mb-1 font-mono text-[7px] tracking-[0.2em] text-white/30">
                  HOW THE STREAMS ARE RESOLVED
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STREAM_MODES.map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setStreamMode(id)}
                      className={`rounded-full border px-2.5 py-1 font-mono text-[7px] tracking-[0.18em] transition ${
                        streamMode === id
                          ? 'border-white/50 bg-white/10 text-white/85'
                          : 'border-white/12 text-white/40 hover:border-white/30 hover:text-white/70'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
                  THE DIRECT RESOLVER ASKS YOUTUBE&apos;S APP CLIENTS, WHICH HAND BACK A PLAIN
                  ADDRESS — NO SIGNATURE TO SOLVE, NO TOKEN, A FEW HUNDRED MILLISECONDS. THE
                  EXTRACTOR IS SLOWER BUT GETS THE TRACKS THE DIRECT ONE REFUSES.
                </p>
              </div>
            </div>
          )}

          <input
            value={ytDlpPath}
            onChange={(e) => setYtDlpPath(e.target.value)}
            placeholder="WHERE yt-dlp LIVES (LEAVE EMPTY FOR THE PATH)"
            className="mt-2 w-full border border-amber-300/20 bg-black/30 px-2 py-1.5 font-mono text-[9px] text-white/80 outline-none transition placeholder:text-white/20 focus:border-amber-300/50"
          />
          <input
            value={ytDlpArgs}
            onChange={(e) => setYtDlpArgs(e.target.value)}
            placeholder="EXTRA ARGUMENTS, e.g. --cookies-from-browser chrome"
            className="mt-1.5 w-full border border-amber-300/20 bg-black/30 px-2 py-1.5 font-mono text-[9px] text-white/80 outline-none transition placeholder:text-white/20 focus:border-amber-300/50"
          />
          <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-amber-200/35">
            THE EXTRA ARGUMENTS ARE YOURS TO SET. THE APP NEVER ADDS ANY BY ITSELF — A COOKIE
            ARGUMENT MEANS yt-dlp READS YOUR OWN BROWSER&apos;S COOKIES, AND ONLY YOURS.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-full border border-white/30 px-4 py-1.5 font-mono text-[9px] tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white disabled:opacity-40"
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
          <button
            onClick={() => void check()}
            disabled={checking}
            className="rounded-full border border-white/15 px-4 py-1.5 font-mono text-[9px] tracking-[0.2em] text-white/45 transition hover:border-white/40 hover:text-white/70 disabled:opacity-40"
          >
            {checking ? 'CHECKING…' : 'CHECK NOW'}
          </button>
          {note && (
            <span className="flex items-center gap-1 font-mono text-[8px] tracking-[0.15em] text-white/40">
              {note === 'SAVED' ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
              {note}
            </span>
          )}
          {checking && <Loader2 className="h-3 w-3 animate-spin text-white/30" />}
        </div>
      </div>

      {signInOpen && (
        <YouTubeSignIn
          onClose={() => {
            setSignInOpen(false)
            void load()
          }}
          onChanged={() => {
            void load()
          }}
        />
      )}
    </div>
  )
}
