/**
 * The chain, wired into the lyric component.
 *
 * `<am-lyrics>` fetches for itself, and it did so with a chain of its own.
 * That chain is replaced here by the app's own: the providers in the
 * registry, asked in the order the person using the player has set.
 *
 * What is NOT replaced is the drawing. The component still parses the
 * answer, still lays the lines out, still runs the highlight and the
 * scroll. The app only decides WHO is asked and in what order — and what
 * comes back is put into the component's own source list, so the SOURCE
 * label and the provider list in the settings panel agree with what is on
 * screen.
 *
 * The component is a dependency, not ours, so the wiring is defensive by
 * design: if its internals are not the shape this file expects, nothing is
 * patched and the app behaves exactly as it did.
 */

import { lyricsComponent, type LyricsLine } from './component.ts'
import { PROVIDER_IDS, fetchProvider, providerById, runProviderChain } from './registry.ts'
import { readProviderOrder } from './order.ts'
import type { ProviderPayload, TrackQuery } from './providers.ts'

/** the tag the component registers itself under */
const TAG = 'am-lyrics'

/** where the current provider's id is kept on the element */
const PROVIDER_ID = '__mavisLyricsProviderId'

/** the event the element fires when the provider changes */
export const PROVIDER_EVENT = 'lyrics-provider-changed'

/** the pieces of the component this file reaches for */
interface SourceEntry {
  lines: LyricsLine[]
  source: string
  originalTTML?: string
  songwriters?: string
}

interface ComponentInternals {
  ttml?: string
  songTitle?: string
  songArtist?: string
  songDurationMs?: number
  duration?: number
  lyrics?: LyricsLine[]
  lyricsSource?: string | null
  availableSources?: SourceEntry[]
  currentSourceIndex?: number
  hasFetchedAllProviders?: boolean
  isLoading?: boolean
  fetchAbortController?: AbortController
  [PROVIDER_ID]?: string
  _updateFooter?: () => void
  onLyricsLoaded?: () => Promise<void> | void
  fetchLyrics?: () => Promise<void>
}

interface ComponentConstructor {
  prototype: ComponentInternals
  parseTTML?: (ttml: string) => { lines: LyricsLine[]; songwriters?: string } | null
  convertKPoeLyrics?: (payload: unknown) => LyricsLine[] | null
}

let installed = false

/** the constructor, once the component has registered itself */
function componentConstructor(): ComponentConstructor | null {
  if (typeof customElements === 'undefined') return null
  const ctor = customElements.get(TAG) as unknown as ComponentConstructor | undefined
  return ctor ?? null
}

/**
 * Turn a provider's answer into the lines the component draws.
 *
 * The component's own parsers do the work — the same code that reads a
 * pinned lyric reads this one, so the two are indistinguishable on screen.
 */
export function payloadToLines(
  payload: ProviderPayload,
): { lines: LyricsLine[]; songwriters?: string } | null {
  const ctor = lyricsComponent()
  if (!ctor) return null
  if (payload.kind === 'kpoe') {
    const lines = ctor.convertKPoeLyrics?.(payload.payload)
    return lines && lines.length ? { lines } : null
  }
  return ctor.parseTTML?.(payload.ttml) ?? null
}

/**
 * Put a provider's answer where the component expects one.
 *
 * The component's own machinery is used for all of it: the source list, the
 * label, the footer. So the SOURCE readout in the settings panel says
 * where the words came from, and the provider list can mark the one that
 * is currently serving.
 */
export function applyLyricsResult(
  target: ComponentInternals,
  providerId: string,
  payload: ProviderPayload,
): boolean {
  const parsed = payloadToLines(payload)
  if (!parsed || !parsed.lines.length) return false

  const provider = providerById(providerId)
  const label = payload.label || provider?.label || 'Unknown'

  target.availableSources = [
    {
      lines: parsed.lines,
      source: label,
      originalTTML: payload.kind === 'ttml' ? payload.ttml : undefined,
      songwriters: parsed.songwriters,
    },
  ]
  target.currentSourceIndex = 0
  target.lyrics = parsed.lines
  target.lyricsSource = label
  target.hasFetchedAllProviders = true
  target[PROVIDER_ID] = providerId
  target._updateFooter?.()
  return true
}

/** the provider currently serving, as far as the element knows */
export function currentProviderId(target: ComponentInternals | null): string | null {
  return target?.[PROVIDER_ID] ?? null
}

/* The last provider announced anywhere in the app. The queue panel's track
   editor is not inside the lyrics element, so it reads this when it opens to
   name the source the current fetch is using. Purely informational. */
let lastProviderId: string | null = null

/** the provider that last served lyrics, for UI that lives outside the element */
export function getLastProviderId(): string | null {
  return lastProviderId
}

/** tell the page the provider changed, so the panel can redraw */
function announce(target: ComponentInternals): void {
  lastProviderId = target[PROVIDER_ID] ?? null
  const el = target as unknown as EventTarget
  if (typeof el.dispatchEvent !== 'function') return
  try {
    el.dispatchEvent(
      new CustomEvent(PROVIDER_EVENT, { detail: { id: target[PROVIDER_ID] ?? null } }),
    )
  } catch {
    /* an element that cannot announce is still an element that renders */
  }
}

/** the track the element is asking about */
function queryOf(target: ComponentInternals): TrackQuery {
  return {
    title: (target.songTitle ?? '').trim(),
    artist: (target.songArtist ?? '').trim(),
    durationMs: Number(target.songDurationMs ?? target.duration ?? 0),
  }
}

/**
 * Put the chain in place.
 *
 * Safe to call more than once — the patch is installed once.
 */
export function installLyricsProviderChain(): void {
  if (installed) return
  const ctor = componentConstructor()
  if (!ctor) {
    /* the component has not registered itself yet — try again once it has */
    if (typeof customElements !== 'undefined') {
      void customElements.whenDefined(TAG).then(() => installLyricsProviderChain())
    }
    return
  }
  /* the internals this file relies on are not the shape it expects: leave the
     component completely alone rather than patch it wrong */
  if (typeof ctor.parseTTML !== 'function') return
  const prototype = ctor.prototype
  const original = prototype.fetchLyrics
  if (typeof original !== 'function') return

  prototype.fetchLyrics = async function patchedFetchLyrics(
    this: ComponentInternals,
  ): Promise<void> {
    /* a pinned lyric — one stored on the machine, or the radio's own — is
       read, not fetched. The component already does this perfectly, so it
       is left to do it. */
    if (this.ttml) {
      await original.call(this)
      this[PROVIDER_ID] = undefined
      announce(this)
      return
    }

    /* Cancel any in-flight fetch so a stale answer cannot race a new one */
    this.fetchAbortController?.abort()
    const controller = new AbortController()
    this.fetchAbortController = controller

    this.isLoading = true
    this.lyrics = undefined
    this.lyricsSource = null
    this.availableSources = []
    this.currentSourceIndex = 0
    this.hasFetchedAllProviders = false
    this._updateFooter?.()

    try {
      const query = queryOf(this)
      if (!query.title || !query.artist) return

      /* the order is read at the moment of the fetch, so a change made in
         the settings panel applies to the next track without a reload */
      const order = readProviderOrder(PROVIDER_IDS)
      const hit = await runProviderChain(query, order, controller.signal)
      if (controller.signal.aborted) return
      if (!hit) {
        this.lyrics = undefined
        this.lyricsSource = null
        this.availableSources = []
        this.hasFetchedAllProviders = true
        this._updateFooter?.()
        announce(this)
        return
      }
      if (!applyLyricsResult(this, hit.id, hit.payload)) return
      announce(this)
      await this.onLyricsLoaded?.()
    } finally {
      /* Only update loading state if this fetch wasn't superseded */
      if (!controller.signal.aborted) {
        this.isLoading = false
      }
    }
  }

  /* a marker, so the wiring can be seen from outside — by the verification
     harness, and by anyone reading the element's prototype later */
  ;(prototype.fetchLyrics as unknown as { __mavisFallbackChain?: boolean }).__mavisFallbackChain = true

  installed = true
}

/**
 * Ask ONE provider for the track, whatever the order says.
 *
 * This is the "force this provider" path: the answer replaces the lyric on
 * screen, and a provider that has nothing leaves what is on screen alone.
 */
export async function forceProvider(
  target: ComponentInternals,
  providerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const provider = providerById(providerId)
  if (!provider) return { ok: false, error: 'UNKNOWN PROVIDER' }
  if (!provider.available) return { ok: false, error: 'NOT AVAILABLE' }

  const query = queryOf(target)
  if (!query.title || !query.artist) return { ok: false, error: 'NO TRACK' }

  const payload = await fetchProvider(providerId, query)
  if (!payload) return { ok: false, error: 'NOTHING FOUND' }
  if (!applyLyricsResult(target, providerId, payload)) {
    return { ok: false, error: 'COULD NOT READ' }
  }
  announce(target)
  await target.onLyricsLoaded?.()
  return { ok: true }
}
