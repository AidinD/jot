import { useEffect, useRef, useState } from 'react'
import { renderMarkdown } from '@shared/markdown'

interface DescriptionModalProps {
  value: string
  onClose: (next: string) => void
}

/**
 * Full-size editor for a todo's description, opened by clicking the "Description"
 * label in the detail panel. Autosaves like the rest of the panel — no Cancel
 * button, since closing any way (overlay click, Escape, the × button) commits
 * the current text. Text is markdown source; the Preview tab renders it the
 * same way the collapsed panel preview does.
 */
export function DescriptionModal({ value, onClose }: DescriptionModalProps): JSX.Element {
  const [draft, setDraft] = useState(value)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
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
        <div className="description-modal-tabs">
          <button
            type="button"
            className={`description-modal-tab${mode === 'edit' ? ' active' : ''}`}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className={`description-modal-tab${mode === 'preview' ? ' active' : ''}`}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
        </div>
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            className="description-modal-textarea"
            placeholder="Add notes… (markdown supported)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <div
            className="description-modal-textarea description-modal-preview markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
          />
        )}
      </div>
    </div>
  )
}
