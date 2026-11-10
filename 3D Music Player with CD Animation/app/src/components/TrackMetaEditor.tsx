import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ImagePlus, Trash2, X } from 'lucide-react'
import type { Track } from '../hooks/useAudioEngine'
import { useChromeDrag, type ChromeOffset } from '../features/layout/useChromeDrag'

interface Props {
  track: Track
  /* the trigger's rect — the card opens below/right of it */
  anchor: DOMRect
  onSave: (title: string, artist: string, cover?: string) => void
  onClose: () => void
  /** layout editor — drag this card while an edit session runs */
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}

const W = 300

/**
 * Inline title/artist editor, shared by the now-playing header and the
 * tracklist rows. Lyrics matching is metadata-bound: lrc.red takes
 * `song-title` + `song-artist`, so a mis-tagged import fetches the wrong
 * lyrics and there is no way to fix it downstream — hence this.
 *
 * Portaled to <body> because the stage applies `filter`/`transform` to its
 * subtree, which would make `position: fixed` relative to the wrong box.
 */
export default function TrackMetaEditor({ track, anchor, onSave, onClose, editing = false, offset, onOffset }: Props) {
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [cover, setCover] = useState(track.cover)
  const [coverBusy, setCoverBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const drag = useChromeDrag({ editing, offset, onOffset })

  /* measured height: the card grew when the POSTER section was added, and a
     hardcoded estimate put the REMOVE button off-screen on short viewports */
  const [cardH, setCardH] = useState(190)
  useLayoutEffect(() => {
    const el = cardRef.current
    if (el) setCardH(el.offsetHeight)
  }, [cover])

  /* placement: prefer below the trigger, flip above when it would clip,
     and shift left of the trigger when there is no room to the right.
     Clamped to the viewport — every option must stay reachable. */
  const overflowRight = anchor.left + W + 24 > window.innerWidth
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - W - 12)) - (overflowRight ? W - anchor.width : 0)
  const below = anchor.bottom + 8
  const fitsBelow = below + cardH <= window.innerHeight - 12
  const top = fitsBelow
    ? below
    : Math.max(12, Math.min(window.innerHeight - cardH - 12, anchor.top - cardH - 8))

  /* focus + preselect: the field almost always needs replacing wholesale */
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  /* Escape cancels, a click outside cancels — a stray editor must never
     trap the pointer over the player */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onDown = (e: PointerEvent) => {
      /* guard the Node cast: Node.contains on a non-Node target throws, and an
         uncaught throw here paints over the whole player */
      if (!(e.target instanceof Node) || !cardRef.current?.contains(e.target)) onClose()
    }
    window.addEventListener('keydown', onKey)
    /* capture: the rows below stopPropagation on their own clicks, so a
       bubbling listener would never see the first click outside */
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const save = () => {
    const t = title.trim()
    if (!t) return
    onSave(t, artist.trim(), cover)
    onClose()
  }

  const onCoverFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      setCover(reader.result as string)
      setCoverBusy(false)
    }
    reader.onerror = () => setCoverBusy(false)
    reader.readAsDataURL(file)
  }

  return createPortal(
    <div
      ref={cardRef}
      className={`panel-resizable fixed z-[95] rounded-2xl border border-white/15 bg-black/90 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-md ${drag.editClass}`}
      style={{ left, top, width: W, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', ...drag.style }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDownCapture={drag.onPointerDown}
      onClickCapture={drag.onClickCapture}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">EDIT TRACK INFO</span>
        <button onClick={onClose} aria-label="Cancel" className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      <label className="mb-1 block font-mono text-[8px] tracking-[0.2em] text-white/35">TITLE</label>
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const next = cardRef.current?.querySelector<HTMLInputElement>('input[name="artist"]')
            if (next) {
              next.focus()
              next.select()
            }
          }
        }}
        spellCheck={false}
        className="mb-3 w-full rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none transition focus:border-white/40"
      />

      <label className="mb-1 block font-mono text-[8px] tracking-[0.2em] text-white/35">ARTIST</label>
      <input
        name="artist"
        value={artist}
        onChange={(e) => setArtist(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          }
        }}
        spellCheck={false}
        className="mb-4 w-full rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm font-mono text-white outline-none transition focus:border-white/40"
      />

      <label className="mb-1 block font-mono text-[8px] tracking-[0.2em] text-white/35">POSTER</label>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-white/5">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="font-mono text-[8px] tracking-[0.15em] text-white/20">NO POSTER</span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <button
            onClick={() => coverInputRef.current?.click()}
            disabled={coverBusy}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-[8px] tracking-[0.15em] text-white/70 transition hover:border-white/30 hover:text-white disabled:opacity-40"
          >
            <ImagePlus size={11} />
            {coverBusy ? 'LOADING' : cover ? 'REPLACE' : 'ADD'}
          </button>
          {cover && (
            <button
              onClick={() => setCover(undefined)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-[8px] tracking-[0.15em] text-white/40 transition hover:border-red-400/40 hover:text-red-300"
            >
              <Trash2 size={11} />
              REMOVE
            </button>
          )}
        </div>
      </div>
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        onChange={onCoverFile}
        className="hidden"
      />

      <button
        onClick={save}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 font-mono text-[9px] tracking-[0.2em] text-black transition-transform duration-150 hover:scale-[1.02] active:scale-95"
        style={{
          background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
          boxShadow:
            'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 3px 10px rgba(0,0,0,0.5)',
        }}
      >
        <Check size={12} strokeWidth={2.5} />
        SAVE
      </button>
      <p className="mt-2.5 text-center font-mono text-[8px] leading-relaxed tracking-[0.1em] text-white/25">
        used for lyrics matching
      </p>
    </div>,
    document.body,
  )
}
