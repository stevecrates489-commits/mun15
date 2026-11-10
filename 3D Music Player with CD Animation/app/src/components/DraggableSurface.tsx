import { Children, cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { useChromeDrag, type ChromeOffset } from '../features/layout/useChromeDrag'

interface Props {
  /** stable id — the storage key for this surface's offset */
  id: string
  /** edit session on */
  editing: boolean
  offset?: ChromeOffset
  onOffset: (id: string, o: ChromeOffset) => void
  children: ReactNode
}

/**
 * Makes one element draggable while a layout edit session runs, without
 * changing how it lays out. The child is cloned, never wrapped: a wrapper div
 * would join a flex row (or add a box to an absolutely-positioned group) and
 * quietly move everything beside it.
 *
 * The offset is applied with CSS `translate`, so positioning, transforms,
 * animations and hover scales on the child all keep working. Outside an edit
 * session the component adds nothing but the saved offset.
 */
export default function DraggableSurface({ id, editing, offset, onOffset, children }: Props) {
  const drag = useChromeDrag({
    editing,
    offset,
    onOffset: (o) => onOffset(id, o),
  })

  const child = Children.only(children)
  if (!isValidElement(child)) return <>{children}</>

  const props = child.props as {
    style?: CSSProperties
    className?: string
    onClickCapture?: (e: React.MouseEvent) => void
    onPointerDownCapture?: (e: React.PointerEvent) => void
  }

  const element = child as ReactElement<Record<string, unknown>>

  return cloneElement(element, {
    style: { ...(props.style ?? {}), ...drag.style },
    className: [props.className, drag.editClass].filter(Boolean).join(' '),
    /* capture phase: while arranging, the surface owns the press before any
       control inside it sees one (see useChromeDrag) */
    onPointerDownCapture: (e: React.PointerEvent) => {
      drag.onPointerDown(e)
      props.onPointerDownCapture?.(e)
    },
    onClickCapture: (e: React.MouseEvent) => {
      drag.onClickCapture(e)
      props.onClickCapture?.(e)
    },
  })
}
