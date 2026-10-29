/**
 * The Dannify extension, from the interface's side.
 *
 * Three calls: start it and hand back its address; ask it who it is signed
 * in as; and sign it in. The sign-in is the player's own window — Dannify's
 * interface cannot do it itself outside its desktop shell, and says so.
 */

import { invoke } from '@tauri-apps/api/core'

/** Who the extension is signed in to YouTube Music as. */
export interface DannifyAccount {
  signed_in: boolean
  profile?: { name?: string; handle?: string; photo?: string }
  /** Why the sign-in did not take, when it did not. */
  error?: string
  /** True when the sign-in window was closed without finishing. */
  cancelled?: boolean
  /** True when nobody signed in before the browser sign-in gave up. */
  timeout?: boolean
  /** True when no browser could be opened for the sign-in. */
  unavailable?: boolean
}

/** Start the extension if needed, and return its address. */
export const dannifyOpen = () => invoke<string>('dannify_open')

/** Ask the extension who it is signed in as. */
export const dannifyAccount = () => invoke<DannifyAccount>('dannify_account')

/** What the extension reports about itself.
 *
 * The player asks once the window is up. The answer is what makes an
 * update that moved something visible: the extension probes every name the
 * player reaches for in it (sign-in, the downloads list, the update stub,
 * the download socket) and lists the ones that went missing. An extension
 * from before this route answers 404, which the Rust side turns into
 * `contract: 0` — no report available, not a problem.
 */
export interface DannifyReport {
  /** false when the extension is not running at all. */
  running?: boolean
  /** The revision of the player's own routes this copy publishes. */
  contract?: number
  /** The version of Dannify running underneath the bridge. */
  dannify?: string
  /** How many names were probed. */
  checked?: number
  /** True when every name the player uses is still there. */
  ok?: boolean
  /** The names that went missing, and what each was for. */
  missing?: { check: string; for: string; missing: string }[]
}

/** Ask the extension what it is, and whether everything still works. */
export const dannifyVersion = () => invoke<DannifyReport>('dannify_version')

/**
 * Sign the extension in. This opens the browser on YouTube Music's sign-in
 * page and waits while the user signs in; the session is taken from that
 * browser and given to the extension. If no browser can be opened, the
 * player's own sign-in window is used instead.
 */
export const dannifySignIn = () => invoke<DannifyAccount>('dannify_sign_in')
