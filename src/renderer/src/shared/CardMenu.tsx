import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { clampToViewport } from './reference'
import { jotApi } from '../jotApiClient'

/*
 * The right-click menu on a card.
 *
 * It exists for one job: handing over a reference to the todo that can be pasted
 * into a conversation. Describing a card by what it says is ambiguous the moment
 * two of them say something similar; `jot:<id>` is not.
 *
 * Built in the app rather than as Electron's native context menu — the suite's
 * rule about native dialogs, and a practical reason too: a native menu cannot
 * show the id, and reading it is half of what this is for. It also has to work
 * in Helm's embedded Jot tab, which has no Electron menu of Jot's to call.
 *
 * Ported from Nib's CardMenu, so a note and a card answer the same gesture the
 * same way.
 */

interface CardMenuProps {
  /** Where the pointer was, in viewport coordinates. */
  at: { left: number; top: number }
  /** The todo's own id, shown as well as copied. */
  todoId: string
  reference: string
  onClose: () => void
}

export function CardMenu({ at, todoId, reference, onClose }: CardMenuProps): JSX.Element {
  const [state, setState] = useState<'ready' | 'copied' | 'failed'>('ready')
  const box = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState(at)

  // Measured after the first paint rather than guessed from a fixed width.
  useEffect(() => {
    const element = box.current
    if (element === null) {
      return
    }
    const rect = element.getBoundingClientRect()
    const next = clampToViewport(
      at,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
    if (next.left !== place.left || next.top !== place.top) {
      setPlace(next)
    }
  }, [at, place.left, place.top])

  // Escape closes it, and so does a click anywhere else — both on capture, so a
  // click on the thing underneath does not also do whatever that thing does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  /*
   * Through the host where it offers a clipboard, `navigator.clipboard` where it
   * does not (Helm's embedded board, which has no bridge of Jot's to call).
   *
   * Awaited, and the result is what the row reports. The browser call rejects
   * with "Document is not focused" rather than throwing at the call site, so a
   * fire-and-forget copy can leave the row saying "Copied" over a clipboard that
   * never changed - which is worse than saying nothing, because you paste the
   * previous thing into a conversation and never look twice.
   */
  async function copy(): Promise<void> {
    try {
      const host = jotApi().copyText
      if (host !== undefined) {
        await host(reference)
      } else {
        await navigator.clipboard.writeText(reference)
      }
      setState('copied')
      // Long enough to read, short enough not to be in the way. The menu closes
      // itself so there is no second click to dismiss what you already did.
      window.setTimeout(onClose, 700)
    } catch {
      // Left open on purpose: the id is right there to select by hand, which is
      // the whole fallback.
      setState('failed')
    }
  }

  /*
   * Rendered into `document.body`, unlike Nib's, which sits where it is used.
   * Every card here is a dnd-kit sortable, and dnd-kit writes a `transform` onto
   * the element it drags — a transformed ancestor makes `position: fixed`
   * resolve against the CARD instead of the window, which would throw the menu
   * across the screen mid-drag. The portal takes the question away entirely.
   */
  return createPortal(
    <div
      className="card-menu"
      ref={box}
      style={{ left: place.left, top: place.top }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" className="card-menu-row" onClick={() => void copy()}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy reference'}
      </button>
      {/* The id itself, because sometimes the answer is to read it out rather
          than to paste it. Selectable on purpose. */}
      <span className="card-menu-id">{todoId}</span>
    </div>,
    document.body
  )
}

export interface CardMenuTarget {
  id: string
  text: string
}

export interface CardMenuState {
  target: CardMenuTarget
  at: { left: number; top: number }
}

/**
 * The right-click half of the menu, so every surface that shows a card opens it
 * the same way — and so a row that contains other rows (a todo with subtasks)
 * cannot hand over its parent's id for a child that was right-clicked.
 */
export function useCardMenu(): {
  menu: CardMenuState | null
  open: (event: MouseEvent, target: CardMenuTarget) => void
  close: () => void
} {
  const [menu, setMenu] = useState<CardMenuState | null>(null)
  return {
    menu,
    open: (event, target) => {
      event.preventDefault()
      // The innermost card wins: without this a right-click on a subtask would
      // also reach the todo it sits under, and the last handler to run would
      // decide which id you copied.
      event.stopPropagation()
      setMenu({ target, at: { left: event.clientX, top: event.clientY } })
    },
    close: () => setMenu(null)
  }
}
