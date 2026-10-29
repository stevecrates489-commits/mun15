/**
 * Talking to the source registry.
 *
 * The registry lives in Rust. From here it looks like four calls:
 *
 * - `sources_status` — what is configured, what is healthy.
 * - `sources_search` — find something.
 * - `sources_play` — open it, and get back a URL to play.
 * - `sources_cancel` — stop opening it.
 *
 * The URL that comes back is a **loopback** address: `http://127.0.0.1:port`
 * with an opaque id. It means nothing outside this machine, it changes every
 * run, and the address the music actually comes from never crosses into the
 * webview. That is the whole point of the design, and it is why the frontend
 * never sees a provider's address.
 */

import { invoke } from '@tauri-apps/api/core'

/** A piece of content, as a source describes it. */
export interface SourceMetadata {
  title: string
  artist: string
  album: string
  durationSecs: number | null
  artworkUrl: string | null
  license: string | null
}

/** One search result. */
export interface SourceSearchResult {
  metadata: SourceMetadata
  /** `provider:external-id` — the id the registry understands. */
  contentId: string
  provider: string
  /** Whether this provider can actually play what it found. */
  playable: boolean
  /** Why it cannot, when it cannot. */
  note: string | null
}

/** How a source is doing. */
export type SourceHealth = 'unknown' | 'healthy' | 'unhealthy' | 'degraded'

/** One source's state. */
export interface SourceStatus {
  id: string
  displayName: string
  health: SourceHealth
  strikes: number
  /** When the quarantine ends, in ms since the epoch. `null` when it is not
   *  quarantined. */
  quarantinedUntil: number | null
  attempts: number
  successes: number
  failures: number
  avgLatencyMs: number
  bytes: number
  configured: boolean
  notConfiguredReason: string | null
  lastKnownGood: boolean
}

/** The settings the user can change. */
export interface SourceSettings {
  jamendoClientId: string | null
  /** Whether to allow the YouTube adapter. Off by default. */
  allowYoutube: boolean
  /** Spotify.s client id, from developer.spotify.com. */
  spotifyClientId: string | null
  /**
   * Which browser the YouTube sign-in opens.
   *
   * `automatic` means the first one found, and Brave is the first one
   * looked for.
   */
  signInBrowser: string
  /** Where the `yt-dlp` program is. `None` means "look on the PATH". */
  ytDlpPath: string | null
  /** Extra arguments for `yt-dlp`, e.g. `--cookies-from-browser chrome`. */
  ytDlpArgs: string[]
  /**
   * How the streams are resolved.
   *
   * - `fast` — the direct resolver first, then the extractor.
   * - `fastOnly` — only the direct resolver. Quickest, refuses some tracks.
   * - `extractor` — only yt-dlp. Slower, but it gets the awkward ones.
   */
  streamMode: string
}

/** The ways the streams can be resolved. */
export const STREAM_MODES: [string, string][] = [
  ['fast', 'FAST, THEN THE EXTRACTOR'],
  ['fastOnly', 'FAST ONLY'],
  ['extractor', 'THE EXTRACTOR ONLY'],
]

/** The browsers the sign-in can use. */
export const BROWSER_CHOICES: { id: string; label: string }[] = [
  { id: 'automatic', label: 'THE FIRST ONE FOUND' },
  { id: 'brave', label: 'BRAVE' },
  { id: 'chrome', label: 'CHROME' },
  { id: 'edge', label: 'EDGE' },
  { id: 'vivaldi', label: 'VIVALDI' },
]

/** Everything the settings screen needs. */
export interface SourcesStatus {
  sources: SourceStatus[]
  /** The loopback base URL. Not a remote address. */
  baseUrl: string
  settings: SourceSettings
}

export const sourcesStatus = () => invoke<SourcesStatus>('sources_status')

export const sourcesSetSettings = (settings: SourceSettings) =>
  invoke<SourcesStatus>('sources_set_settings', { settings })

export const sourcesSearch = (provider: string, query: string, limit?: number) =>
  invoke<SourceSearchResult[]>('sources_search', { provider, query, limit })

export const sourcesSearchAll = (query: string, limit?: number) =>
  invoke<SourceSearchResult[]>('sources_search_all', { query, limit })

/**
 * Open a stream and get back the URL to play.
 *
 * The registry does the work of finding a source that will actually
 * deliver, and of proving there is a byte behind it, before this resolves.
 * The URL that comes back is local.
 */
export const sourcesPlay = (contentId: string) => invoke<string>('sources_play', { contentId })

export const sourcesCancel = () => invoke<void>('sources_cancel')

export const sourcesHealthCheck = () => invoke<unknown[]>('sources_health_check')

/* ---- the YouTube Music sign-in ---- */

/** How the sign-in stands. */
export interface SignInStatus {
  /** Whether a browser is open and waiting for the user. */
  waiting: boolean
  /** The account the session belongs to. */
  accountName: string | null
  email: string | null
  /**
   * Whether the account has YouTube Music Premium.
   *
   * This is the thing that decides whether the streams carry adverts.
   */
  premium: boolean | null
  /** Whether there is a session at all. */
  signedIn: boolean
  channelId: string | null
  /** Where the sign-in profile lives, while a sign-in is in progress. */
  profilePath: string | null
}

/** Open a browser with a profile of its own, and wait for the sign-in. */
export const youtubeSignInStart = () => invoke<SignInStatus>('youtube_sign_in_start')

/** The user says they are done. Collect the cookies and build the session. */
export const youtubeSignInFinish = () => invoke<SignInStatus>('youtube_sign_in_finish')

/** The sign-in, abandoned. The browser is closed and nothing is kept. */
export const youtubeSignInCancel = () => invoke<SignInStatus>('youtube_sign_in_cancel')

/** How the sign-in stands right now. */
export const youtubeSignInStatus = () => invoke<SignInStatus>('youtube_sign_in_status')

/** Sign out: forget the session. */
export const youtubeSignOut = () => invoke<SignInStatus>('youtube_sign_out')

/** One thing from the account's library or a playlist. */
export interface LibraryItem {
  /** The video id — YouTube calls a song a video. */
  videoId: string
  title: string
  artist: string
  album: string
  durationSecs: number | null
  artworkUrl: string | null
}

/** One card — an album, an artist, a playlist. Not a track: it is opened. */
export interface LibraryCard {
  /** The id to open it with. */
  browseId: string
  /** ALBUM, ARTIST, PLAYLIST. */
  kind: string
  title: string
  subtitle: string
  artworkUrl: string | null
}

/**
 * What a browse came back with: the tracks in it, and the cards.
 *
 * They are kept apart on purpose. A card has no video id — it has a
 * browse id, which names a collection to open. Mixing them is what puts
 * a row in the list that then will not play.
 */
export interface Browse {
  tracks: LibraryItem[]
  cards: LibraryCard[]
}

/** The account's library. */
export const youtubeLibrary = (section?: string) => invoke<Browse>('youtube_library', { section })

/** One of the account's playlists. */
export const youtubePlaylist = (playlistId: string) => invoke<Browse>('youtube_playlist', { playlistId })

/** The account's playlists, by name. */
export const youtubePlaylists = () => invoke<Browse>('youtube_playlists')

/** The ways the streams can be resolved. */
export const youtubeStreamModes = () => invoke<[string, string][]>('youtube_stream_modes')

/** The library sections, and what they are called. */
export const youtubeLibrarySections = () =>
  invoke<[string, string][]>('youtube_library_sections')

/** Write the session's cookies out for `yt-dlp`. */
export const youtubeExportCookies = () => invoke<string>('youtube_export_cookies')

/** Download a track to a file. Returns the path. */
export const youtubeDownload = (videoId: string) => invoke<string>('youtube_download', { videoId })

/** What YouTube thinks of a track, and whether it can be played. */
export interface TrackInfo {
  title: string
  artist: string
  album: string
  artworkUrl: string | null
  durationSecs: number | null
  playable: boolean
  /** Why not, when it may not. */
  reason: string | null
  /** The best audio bitrate on offer, in kbps. */
  bestKbps: number | null
  premium: boolean | null
}

/** Ask YouTube about a track. */
export const youtubeTrackInfo = (videoId: string) => invoke<TrackInfo>('youtube_track_info', { videoId })

/* ---- the Spotify sign-in ---- */

/** Spotify's tokens. The access token is short-lived; the refresh token
 *  is not, so the user does not have to sign in every hour. */
export interface SpotifyTokens {
  accessToken: string
  refreshToken: string | null
  /** When the access token runs out, in ms since the epoch. */
  expiresAt: number
  scope: string | null
}

/** Start the Spotify sign-in. Opens the system browser on Spotify's own
 *  authorize page. */
export const spotifySignInStart = () => invoke<string>('spotify_sign_in_start')

/** The user came back. Exchange the code for a token. */
export const spotifySignInFinish = () => invoke<SpotifyTokens>('spotify_sign_in_finish')

/** The sign-in, abandoned. */
export const spotifySignInCancel = () => invoke<void>('spotify_sign_in_cancel')

/** Is Spotify signed in? */
export const spotifySignInStatus = () => invoke<boolean>('spotify_sign_in_status')

/** Sign out. */
export const spotifySignOut = () => invoke<void>('spotify_sign_out')

/** A human name for a provider, for the UI. */
export const PROVIDER_NAMES: Record<string, string> = {
  jamendo: 'JAMENDO',
  archive: 'ARCHIVE',
  radio: 'RADIO',
  spotify: 'SPOTIFY',
  youtube: 'YOUTUBE',
}

/** The providers, in the order they should be shown. */
export const PROVIDER_ORDER = ['jamendo', 'archive', 'radio', 'youtube', 'spotify']
