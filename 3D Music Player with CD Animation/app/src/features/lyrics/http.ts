/**
 * Getting at a lyric provider.
 *
 * Three of the providers the player falls back to (NetEase, KuGou, QQ Music)
 * answer with no `Access-Control-Allow-Origin` header. A `fetch()` from the
 * web view is therefore refused by the browser before the response is even
 * read — not by the provider, by the browser's own rule.
 *
 * The desktop shell has no such rule. It asks for the same address with
 * `reqwest` and hands the body back as text, so the CORS header never
 * enters the picture. That is the path the app actually takes.
 *
 * The browser path exists for the plain-browser build (and the verification
 * harnesses, which run against a Vite server). There, a direct `fetch` is
 * tried first and a public proxy is used only if the direct attempt is
 * refused. Proxies are unreliable by nature — they rate-limit, they ask for
 * an opt-in, they go away — so the pool has more than one and the first
 * refusal is not the end of it.
 */

import { invoke } from '@tauri-apps/api/core'

/** A provider's answer, as text. */
export interface HttpText {
  /** did the provider answer at all (a 404 is an answer, a timeout is not) */
  ok: boolean
  status: number
  body: string
}

/** is the native shell there at all? — the app also runs in a plain browser */
export const hasNativeShell = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Public CORS proxies, as URL builders.
 *
 * They are a last resort, not a plan: the desktop shell never needs them,
 * and the browser build only reaches them when a direct request was refused.
 * Every one of them is a free service with no promise attached — they
 * rate-limit, they go down, and one of the best-known ones has already been
 * squatted by something else. So the pool is tried in turn and the first
 * refusal is not the end of it, and a provider that cannot be reached is
 * passed over rather than treated as a failure of the whole chain.
 *
 * The honest answer for a machine that runs its own shell is the shell: the
 * request leaves the process directly, and the browser's same-origin rule
 * never comes into it.
 */
const PROXY_POOL: Array<(url: string) => string> = [
  (url) => `https://test.cors.workers.dev/?${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

/** how long one provider gets before it is written off */
const PROVIDER_TIMEOUT_MS = 8_000

/** how long a proxy gets — a proxy is a long shot, not the main road */
const PROXY_TIMEOUT_MS = 6_000

/**
 * Hosts that have already refused to answer.
 *
 * A host that cannot be reached from this machine will not start answering
 * because the next track was asked for. Two refusals are enough to stop
 * asking, so one dead service cannot cost every track a full timeout.
 *
 * The ledger is per host, and it EXPIRES. A host that refused twice an hour
 * ago may well answer now — the network changes, the service comes back — and
 * a refusal that never expires is how a working provider ends up looking
 * permanently dead.
 */
const refusedHosts = new Map<string, { count: number; until: number }>()

/** how many refusals a host gets before it is left alone */
const REFUSAL_LIMIT = 2

/** how long a host is left alone after refusing */
const REFUSAL_COOLDOWN_MS = 60_000

/** the host part of a URL, for the refusal ledger */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** has this host been refusing us, and is the refusal still fresh? */
function isRefused(url: string): boolean {
  const entry = refusedHosts.get(hostOf(url))
  if (!entry) return false
  if (Date.now() >= entry.until) {
    /* the refusal has gone stale — give the host another chance */
    refusedHosts.delete(hostOf(url))
    return false
  }
  return entry.count >= REFUSAL_LIMIT
}

/** note a refusal — and forget it again if the host answers later */
function noteRefusal(url: string, refused: boolean): void {
  const host = hostOf(url)
  if (!refused) {
    refusedHosts.delete(host)
    return
  }
  const entry = refusedHosts.get(host)
  const count = (entry?.count ?? 0) + 1
  refusedHosts.set(host, { count, until: Date.now() + REFUSAL_COOLDOWN_MS })
}

interface ShellBody {
  status: number
  body: string
}

/**
 * Ask the shell for a URL.
 *
 * The shell does the request, so the browser's same-origin rule never
 * applies and the provider's own headers do not need to cooperate.
 *
 * The caller's budget goes WITH it. Without that, every request through the
 * shell took the shell's own fifteen seconds — so one slow catalogue could
 * spend the whole of a track change, and a chain that waits for the slowest
 * provider spent it twenty-five times over.
 */
async function shellGet(
  url: string,
  referer: string | undefined,
  timeoutMs: number,
): Promise<HttpText> {
  const answer = await invoke<ShellBody>('lyrics_http_get', {
    url,
    referer: referer ?? null,
    timeoutMs,
  })
  return { ok: answer.status >= 200 && answer.status < 400, status: answer.status, body: answer.body }
}

/**
 * Ask the browser for a URL.
 *
 * `Referer` cannot be set by script — the browser owns that header — so the
 * provider either accepts the page's own referrer or does not care. The
 * desktop path is the one that can present the referrer a provider expects.
 */
async function browserGet(
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<HttpText> {
  const controller = new AbortController()
  /* `globalThis` rather than `window`: the transport is also loaded outside a
     page (the test runner), and a window that is not there is a crash, not a
     fallback. */
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    const body = await response.text()
    return { ok: response.ok, status: response.status, body }
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Fetch a URL as text, whichever way this build can.
 *
 * A failure is a failure, not an exception: a provider that is down, slow or
 * simply does not have the song is reported the same way, so the chain can
 * move on to the next one.
 *
 * `timeoutMs` is here for the providers that are asked several times over:
 * one slow answer from one catalogue must not cost the whole budget of the
 * gateway that serves them.
 */
export async function httpGet(
  url: string,
  opts: { referer?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HttpText> {
  const { referer, signal, timeoutMs = PROVIDER_TIMEOUT_MS } = opts
  if (signal?.aborted) return { ok: false, status: 0, body: '' }

  if (hasNativeShell()) {
    try {
      return await shellGet(url, referer, timeoutMs)
    } catch {
      /* The shell is there but did not answer — an older build without the
         command, or a command that failed. The browser's own request is the
         next best thing, and it is better than nothing. */
    }
  }

  /* a host that has already refused us is not asked again */
  if (isRefused(url)) return { ok: false, status: 0, body: '' }

  try {
    const answer = await browserGet(url, signal, timeoutMs)
    noteRefusal(url, false)
    return answer
  } catch {
    /* the direct request was refused — most likely the CORS rule. Ask the
       proxy pool all at once and keep whichever answers first: a proxy that
       is dead should cost a moment, not the whole pool's worth of waiting. */
    const proxied = await Promise.any(
      PROXY_POOL.map((build) => browserGet(build(url), signal, PROXY_TIMEOUT_MS)),
    ).catch(() => null)
    if (proxied) {
      noteRefusal(url, false)
      return proxied
    }
    noteRefusal(url, true)
    return { ok: false, status: 0, body: '' }
  }
}

/** fetch and parse as JSON, or nothing */
export async function httpGetJson(
  url: string,
  opts: { referer?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown | null> {
  const answer = await httpGet(url, opts)
  if (!answer.ok || !answer.body) return null
  try {
    return JSON.parse(answer.body) as unknown
  } catch {
    return null
  }
}
