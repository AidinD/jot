import { useEffect, useRef, useState } from 'react'

interface DescriptionModalProps {
  value: string
  onClose: (next: string) => void
}

/**
 * Full-size editor for a todo's description, opened by clicking the (small)
 * preview box in the detail panel. Autosaves like the rest of the panel — no
 * Cancel button, since closing any way (overlay click, Escape, the × button)
 * commits the current text.
 */
export function DescriptionModal({ value, onClose }: DescriptionModalProps): JSX.Element {
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    const el = textareaRef.current
    if (el !== null) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [])

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose(draftRef.current)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={() => onClose(draft)}>
      <div
        className="modal description-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-header">
          <h2 className="modal-title">Description</h2>
          <button className="detail-close" onClick={() => onClose(draft)} title="Close">
            ×
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="description-modal-textarea"
          placeholder="Add notes…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
    </div>
  )
}
