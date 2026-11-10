import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { PROVIDERS } from './registry.ts'

/**
 * The provider list.
 *
 * The order is the chain: whoever is first is asked first. It can be
 * changed by dragging a row, and put back with the reset beside the
 * heading.
 *
 * The drag is pointer-based rather than the browser's own drag-and-drop.
 * That is not a preference: HTML5 drag-and-drop is stuttering in this
 * app's WebView2 by construction — the ghost it draws lives in another
 * process and lags the cursor — so the playlist's own drag was rewritten
 * the same way.
 */

interface Props {
  /** the ids, in the order they are asked */
  order: string[]
  /** the provider currently serving the lyrics */
  activeId: string | null
  /** the order changed */
  onReorder: (order: string[]) => void
  /** ask this provider for the track, whatever the order says */
  onForce: (id: string) => void
  /** the provider being asked right now */
  busyId: string | null
  /** the last thing that went wrong, if anything */
  error: string | null
}

/** move one entry to another place in the list */
function move(list: string[], from: string, to: string): string[] {
  const next = [...list]
  const a = next.indexOf(from)
  const b = next.indexOf(to)
  if (a < 0 || b < 0 || a === b) return next
  next.splice(a, 1)
  next.splice(b, 0, from)
  return next
}

export default function ProviderList({
  order,
  activeId,
  onReorder,
  onForce,
  busyId,
  error,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  const rows = useRef<Record<string, HTMLDivElement | null>>({})

  /* the row the pointer is over decides where the dragged one goes */
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId) return
    for (const [id, el] of Object.entries(rows.current)) {
      if (!el) continue
      const box = el.getBoundingClientRect()
      if (e.clientY >= box.top && e.clientY <= box.bottom && id !== dragId) {
        onReorder(move(order, dragId, id))
        break
      }
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!dragId) return
    const target = e.target as HTMLElement
    if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId)
    setDragId(null)
  }

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">PROVIDERS</span>
        <span
          title="Drag a provider to change the order. The first one is asked first."
          className="font-mono text-[7px] tracking-[0.15em] text-white/25"
        >
          DRAG TO REORDER
        </span>
      </div>

      <div
        className="thin-scroll max-h-[210px] overflow-y-auto overflow-x-hidden rounded-lg border border-white/10 bg-black/25"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {order.map((id) => {
          const provider = PROVIDERS.find((p) => p.id === id)
          if (!provider) return null
          const active = activeId === provider.id
          const busy = busyId === provider.id
          const dragging = dragId === provider.id
          return (
            <div
              key={provider.id}
              data-provider-id={provider.id}
              data-tier={provider.tier}
              data-available={provider.available ? 'yes' : 'no'}
              ref={(el) => {
                rows.current[provider.id] = el
              }}
              className={`flex items-center gap-1.5 border-b border-white/5 px-1.5 py-1 last:border-b-0 ${
                active ? 'bg-white/[0.07]' : ''
              } ${dragging ? 'opacity-60' : ''}`}
            >
              <button
                type="button"
                aria-label={`Reorder ${provider.label}`}
                title="Drag to move this provider"
                onPointerDown={(e) => {
                  e.preventDefault()
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  setDragId(provider.id)
                }}
                className="shrink-0 cursor-grab touch-none p-0.5 text-white/25 transition hover:text-white/50 active:cursor-grabbing"
              >
                <GripVertical size={11} />
              </button>

              <button
                type="button"
                onClick={() => onForce(provider.id)}
                disabled={!provider.available || busyId !== null}
                title={
                  provider.available
                    ? `Fetch this lyric from ${provider.label}`
                    : (provider.unavailableReason ?? provider.note)
                }
                className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left disabled:cursor-not-allowed"
              >
                <span
                  className={`truncate font-mono text-[8.5px] tracking-[0.1em] ${
                    provider.available
                      ? active
                        ? 'text-white'
                        : 'text-white/60 hover:text-white'
                      : 'text-white/25'
                  }`}
                >
                  {provider.short}
                </span>
                {busy && (
                  <span className="shrink-0 font-mono text-[7px] tracking-[0.15em] text-white/40">
                    FETCHING…
                  </span>
                )}
                {!provider.available && (
                  <span className="shrink-0 font-mono text-[7px] tracking-[0.15em] text-white/25">
                    UNAVAILABLE
                  </span>
                )}
              </button>

              <span
                title={active ? 'Serving the lyrics on screen' : provider.note}
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  active
                    ? 'bg-emerald-400'
                    : provider.available
                      ? 'bg-white/15'
                      : 'bg-white/[0.07]'
                }`}
              />
            </div>
          )
        })}
      </div>

      {error && (
        <div
          data-provider-error=""
          className="mt-1.5 font-mono text-[7.5px] tracking-[0.15em] text-rose-300/80"
        >
          {error}
        </div>
      )}
    </div>
  )
}
