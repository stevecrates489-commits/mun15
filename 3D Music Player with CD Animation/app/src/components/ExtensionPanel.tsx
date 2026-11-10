import { useEffect } from 'react'
import { X, Globe, ArrowUpRight } from 'lucide-react'
import { useChromeDrag, type ChromeOffset } from '../features/layout/useChromeDrag'

interface Props {
  /** open the ONLINE extension (Dannify — its own player and library) */
  onOpenOnline: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  /** where the button that opened this sits on screen */
  pos?: { x: number; y: number } | null
  /** layout editor — drag this panel while an edit session runs */
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}

/**
 * The EXTENSION hub. Extensions are the features that live beside the core
 * player instead of inside it — today that is ONLINE (Dannify), which runs
 * in its own window with its own player and library.
 *
 * The panel is a list, not a launcher: one row per installed extension, each
 * row saying what the extension is before it opens. New extensions follow
 * the contract in docs/EXTENSION_SPEC.md; this hub is where they get their
 * entry point, so the corner of the stage does not grow a button per
 * extension.
 */
export default function ExtensionPanel({
  onOpenOnline,
  onClose,
  closing = false,
  onClosed,
  pos = null,
  editing = false,
  offset,
  onOffset,
}: Props) {
  const drag = useChromeDrag({ editing, offset, onOffset })
  useEffect(() => {
    if (!closing || !onClosed) return
    const t = window.setTimeout(onClosed, 200)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  const PANEL_W = 256
  const style: React.CSSProperties = pos
    ? {
        left: Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - PANEL_W - 8)),
        top: Math.min(pos.y, Math.max(8, window.innerHeight - 320)),
      }
    : { left: '5%', top: '13%' }

  return (
    <div
      data-liquid-ignore
      className={`settings-panel panel-resizable fx-blur fixed z-[88] w-64 rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md${
        closing ? ' is-closing' : ''
      } ${drag.editClass}`}
      style={{ ...style, ...drag.style }}
      onPointerDownCapture={drag.onPointerDown}
      onClickCapture={drag.onClickCapture}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">EXTENSIONS</span>
        <button onClick={onClose} aria-label="Close extensions panel" className="text-white/40 hover:text-white">
          <X size={12} />
        </button>
      </div>

      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">INSTALLED</span>
        <span className="font-mono text-[8px] text-white/30">1 OF 1</span>
      </div>

      <button
        onClick={onOpenOnline}
        title="Open the online extension"
        className="group flex w-full items-start gap-2.5 rounded-lg bg-white/5 p-2.5 text-left transition hover:bg-white/10"
      >
        <span className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/10 text-white/70 transition group-hover:text-white">
          <Globe size={13} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] tracking-[0.16em] text-white/85">ONLINE</span>
            <ArrowUpRight size={10} className="shrink-0 text-white/30 transition group-hover:text-white" />
          </span>
          <span className="mt-1 block font-mono text-[7px] leading-relaxed tracking-[0.08em] text-white/35">
            Dannify · its own player and library
          </span>
        </span>
      </button>

      <p className="mt-3 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
        EXTENSIONS ADD FEATURES BESIDE THE CORE PLAYER · THE CONTRACT FOR BUILDING ONE IS IN
        docs/EXTENSION_SPEC.md
      </p>
    </div>
  )
}
