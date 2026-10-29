/**
 * The browse layer, from the frontend's side.
 *
 * These are YouTube Music's own JSON calls, made from Rust with the
 * session's signature on them: the home feed, the library, artists, albums,
 * playlists, moods, radio, and the three things a signed-in account can
 * change.
 */

import { invoke } from '@tauri-apps/api/core'

/** A song. */
export interface BrowseArtistRef {
  name: string
  /** The channel id, so the artist can be followed. */
  id: string | null
}

export interface BrowseSong {
  videoId: string
  name: string
  artists: string[]
  /** The artists, with the channel ids, so they can be followed. */
  artistIds: BrowseArtistRef[]
  albumName: string
  albumId: string | null
  coverUrl: string | null
  durationSecs: number | null
  explicit: boolean
  likeStatus: string | null
  year: string | null
  releaseDate: string | null
  trackNumber: number | null
  albumTrackTotal: number | null
}

/** A card: an album, an artist or a playlist. Not a song — it is opened. */
export interface BrowseCard {
  kind: 'ALBUM' | 'ARTIST' | 'PLAYLIST' | 'PODCAST' | 'MOOD'
  browseId: string
  name: string
  coverUrl: string | null
  subtitle: string
  itemCount: number | null
}

/** A shelf of things. */
export interface BrowseShelf {
  title: string
  cards: BrowseCard[]
  songs: BrowseSong[]
  continuation: string | null
}

/** A search, across every facet. */
export interface BrowseSearchResults {
  songs: BrowseSong[]
  artists: BrowseCard[]
  albums: BrowseCard[]
  playlists: BrowseCard[]
  errors: string[]
}

/** An artist's page. */
export interface BrowseArtist {
  name: string
  description: string
  coverUrl: string | null
  subscribers: string | null
  monthlyListeners: string | null
  channelId: string | null
  songs: BrowseSong[]
  albums: BrowseCard[]
  singles: BrowseCard[]
}

/** An album's page. */
export interface BrowseAlbum {
  name: string
  description: string
  coverUrl: string | null
  artists: string[]
  year: string | null
  trackCount: number | null
  tracks: BrowseSong[]
}

/** A playlist's page. */
export interface BrowsePlaylist {
  name: string
  description: string
  coverUrl: string | null
  author: string | null
  trackCount: number | null
  tracks: BrowseSong[]
  continuation: string | null
}

/* ---- the calls ---- */

export const browseHome = (limit = 6) => invoke<BrowseShelf[]>('browse_home', { limit })

export const browseLiked = (limit = 250) => invoke<BrowseSong[]>('browse_liked', { limit })

export const browseLibraryPlaylists = (limit = 50) =>
  invoke<BrowseCard[]>('browse_library_playlists', { limit })

export const browseSubscriptions = (limit = 100) =>
  invoke<BrowseCard[]>('browse_subscriptions', { limit })

export const browseHistory = (limit = 100) => invoke<BrowseSong[]>('browse_history', { limit })

export const browseArtist = (browseId: string) => invoke<BrowseArtist>('browse_artist', { browseId })

export const browseArtistAlbums = (channelId: string, params: string, limit = 100) =>
  invoke<BrowseCard[]>('browse_artist_albums', { channelId, params, limit })

export const browseAlbum = (browseId: string) => invoke<BrowseAlbum>('browse_album', { browseId })

export const browsePlaylist = (browseId: string, limit = 200) =>
  invoke<BrowsePlaylist>('browse_playlist', { browseId, limit })

export const browsePlaylistContinuation = (continuation: string, limit = 200) =>
  invoke<BrowseSong[]>('browse_playlist_continuation', { continuation, limit })

export const browseMoods = () => invoke<BrowseShelf[]>('browse_moods')

export const browseMoodPlaylists = (params: string) =>
  invoke<BrowseCard[]>('browse_mood_playlists', { params })

export const browseSuggest = (query: string, limit = 8) =>
  invoke<string[]>('browse_suggest', { query, limit })

export const browseSearch = (query: string, limit = 20) =>
  invoke<BrowseSearchResults>('browse_search', { query, limit })

export const browseRadio = (videoId: string, limit = 30) =>
  invoke<BrowseSong[]>('browse_radio', { videoId, limit })

export const browseFollow = (channelId: string, follow: boolean) =>
  invoke<boolean>('browse_follow', { channelId, follow })

export const browseRate = (videoId: string, liked: boolean) =>
  invoke<boolean>('browse_rate', { videoId, liked })

export const browseAddToPlaylist = (playlistId: string, videoIds: string[]) =>
  invoke<boolean>('browse_add_to_playlist', { playlistId, videoIds })

/* ---- the downloads ---- */

/** How a download is doing. */
export type DownloadStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** One download. */
export interface DownloadJob {
  id: string
  videoId: string
  title: string
  artist: string
  album: string
  status: DownloadStatus
  progress: number
  message: string
  filename: string | null
  totalBytes: number | null
  receivedBytes: number
  error: string | null
}

export const downloadsList = () => invoke<DownloadJob[]>('downloads_list')

export const downloadsAdd = (videoId: string, title: string, artist: string, album: string) =>
  invoke<string>('downloads_add', { videoId, title, artist, album })

export const downloadsRemove = (id: string) => invoke<boolean>('downloads_remove', { id })

export const downloadsClearFinished = () => invoke<number>('downloads_clear_finished')

export const downloadsFolder = () => invoke<string>('downloads_folder')
