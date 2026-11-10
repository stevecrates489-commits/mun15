import { useEffect, useRef, useState } from 'react'
import { Check, X, Trash2 } from 'lucide-react'
import { isTtml, lyricsToTtml, ttmlToLrc } from '../lib/ttml'

interface Props {
  title: string
  artist: string
  /* the stored TTML for this track, when there is one */
  localTtml: string | null
  /* pull the currently displayed lyrics as LRC (server or local) */
  onExtract: () => string
  onSave: (ttml: string) => void
  onReset: () => void
  onClose: () => void
}

/**
 * Lyrics editor. Speaks LRC, because that is the format that actually exists
 * on the web, and stores TTML, because that is what the component renders
 * offline. A `[mm:ss.xx]` prefix per line restores word-by-word sync; plain
 * lines render as static text, which is all a "showcase my own words" note
 * needs.
 */
export default function LyricsEditor({ title, artist, localTtml, onExtract, onSave, onReset, onClose }: Props) {
  const [text, setText] = useState(() => (localTtml ? ttmlToLrc(localTtml) : ''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  /* nothing stored yet? seed from what is on screen, so editing starts from
     the fetched lyric instead of a blank box */
  useEffect(() => {
    if (localTtml || !taRef.current) return
    const live = onExtract()
    if (live) setText(live)
  }, [localTtml, onExtract])

  const save = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setErr('Nothing to save')
      return
    }
    const ttml = isTtml(trimmed) ? trimmed : lyricsToTtml(trimmed)
    if (!ttml) {
      setErr('No lyric lines found')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      onSave(ttml)
      onClose()
    } catch {
      setErr('Could not save')
    } finally {
      setBusy(false)
    }
  }

  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="settings-panel panel-resizable w-[min(92vw,560px)] rounded-2xl border border-white/15 bg-black/95 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">EDIT LYRICS</span>
          <button onClick={onClose} aria-label="Close editor" className="text-white/40 hover:text-white">
            <X size={12} />
          </button>
        </div>

        <div className="mb-3 truncate font-mono text-[8px] tracking-[0.15em] text-white/35">
          {title} — {artist}
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={12}
          placeholder={'[00:12.00]First line\n[00:15.50]Second line\n\nLRC timestamps are optional —\nwithout them the text simply stays put.'}
          className="mb-2 w-full resize-y rounded-lg border border-white/15 bg-white/5 p-2.5 font-mono text-[11px] leading-relaxed text-white/90 outline-none transition focus:border-white/40"
        />

        <div className="mb-3 flex items-center justify-between font-mono text-[8px] tracking-[0.15em] text-white/30">
          <span>{lineCount} LINES</span>
          <span>SAVED LOCALLY · NO RE-FETCH</span>
        </div>

        {err && <div className="mb-2 font-mono text-[8px] tracking-[0.15em] text-rose-300">{err}</div>}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-mono text-[9px] tracking-[0.2em] text-black transition-transform duration-150 hover:scale-[1.02] active:scale-95"
            style={{
              background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
              boxShadow:
                'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 3px 10px rgba(0,0,0,0.5)',
            }}
          >
            <Check size={12} strokeWidth={2.5} />
            SAVE LOCALLY
          </button>
          {localTtml && (
            <button
              onClick={() => {
                onReset()
                onClose()
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 font-mono text-[9px] tracking-[0.1em] text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <Trash2 size={11} />
              RESET TO SERVER
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
