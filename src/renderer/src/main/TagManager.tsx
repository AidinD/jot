import { useEffect, useState } from 'react'
import type { Tag } from '@shared/types'

const TAG_PALETTE = [
  '#ff6b6b',
  '#ff8c42',
  '#ffb054',
  '#f4d35e',
  '#5fd0a0',
  '#4fc3d9',
  '#6f9cff',
  '#b98cff'
]

interface TagManagerProps {
  tags: Tag[]
  onClose: () => void
}

/**
 * Modal for defining the reusable tags: name, color (from a preset palette)
 * and the hover text. Edits commit on blur; deletes strip the tag from every
 * todo (handled in the store).
 */
export function TagManager({ tags, onClose }: TagManagerProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_PALETTE[0])

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  function addTag(): void {
    const name = newName.trim()
    if (name.length === 0) {
      return
    }
    void window.jot.addTag(name, newColor, '')
    setNewName('')
    setNewColor(TAG_PALETTE[0])
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal tag-manager"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">Manage tags</h2>

        <div className="tag-manager-list">
          {tags.map((tag) => (
            <div key={tag.id} className="tag-manager-row">
              <div className="tag-swatches">
                {TAG_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`tag-swatch${tag.color === color ? ' active' : ''}`}
                    style={{ background: color }}
                    title={color}
                    onClick={() => window.jot.updateTag(tag.id, { color })}
                  />
                ))}
              </div>
              <input
                className="tag-name-input"
                defaultValue={tag.name}
                placeholder="Name"
                onBlur={(e) => window.jot.updateTag(tag.id, { name: e.target.value })}
              />
              <input
                className="tag-desc-input"
                defaultValue={tag.description}
                placeholder="Hover text…"
                onBlur={(e) => window.jot.updateTag(tag.id, { description: e.target.value })}
              />
              <button
                className="tag-delete"
                title="Delete tag"
                onClick={() => window.jot.removeTag(tag.id)}
              >
                ×
              </button>
            </div>
          ))}
          {tags.length === 0 ? <p className="tag-manager-empty">No tags yet.</p> : null}
        </div>

        <div className="tag-manager-add">
          <div className="tag-swatches">
            {TAG_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className={`tag-swatch${newColor === color ? ' active' : ''}`}
                style={{ background: color }}
                title={color}
                onClick={() => setNewColor(color)}
              />
            ))}
          </div>
          <input
            className="tag-name-input"
            value={newName}
            placeholder="New tag name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addTag()
              }
            }}
          />
          <button className="tag-add-btn" onClick={addTag}>
            Add
          </button>
        </div>

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
