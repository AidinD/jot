import { useEffect, useRef, useState } from 'react'
import type { Category, Todo, TodoStatus } from '@shared/types'

const STATUS_OPTIONS: { value: TodoStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'done', label: 'Done' }
]

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp'
}

interface DetailPanelProps {
  todo: Todo
  category: Category | null
  onClose: () => void
}

export function DetailPanel({ todo, category, onClose }: DetailPanelProps): JSX.Element {
  const [title, setTitle] = useState(todo.text)
  const [description, setDescription] = useState(todo.description)
  const [imagePaths, setImagePaths] = useState<Map<string, string>>(new Map())
  const descRef = useRef<HTMLTextAreaElement>(null)
  const prevIdRef = useRef(todo.id)

  // Sync local state when the selected todo changes
  useEffect(() => {
    if (prevIdRef.current !== todo.id) {
      setTitle(todo.text)
      setDescription(todo.description)
      prevIdRef.current = todo.id
    }
  }, [todo.id, todo.text, todo.description])

  // Resolve image paths
  useEffect(() => {
    let active = true
    const paths = new Map<string, string>()
    Promise.all(
      todo.images.map(async (rel) => {
        const abs = await window.jot.getImagePath(rel)
        if (active) {
          paths.set(rel, abs)
        }
      })
    ).then(() => {
      if (active) {
        setImagePaths(new Map(paths))
      }
    })
    return () => { active = false }
  }, [todo.images])

  // Paste an image from the clipboard (Ctrl+V) onto the open todo. Only handles
  // image data — text pastes fall through untouched so the title/description
  // inputs keep working normally.
  useEffect(() => {
    const todoId = todo.id

    function handlePaste(event: ClipboardEvent): void {
      const items = event.clipboardData?.items
      if (items === undefined) {
        return
      }
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file === null) {
            continue
          }
          event.preventDefault()
          const ext = MIME_TO_EXT[file.type] ?? '.png'
          file.arrayBuffer().then((buffer) => {
            void window.jot.addImageData(todoId, new Uint8Array(buffer), ext)
          })
          return
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [todo.id])

  function saveTitle(): void {
    const trimmed = title.trim()
    if (trimmed.length > 0 && trimmed !== todo.text) {
      window.jot.updateTodo(todo.id, { text: trimmed })
    }
  }

  function saveDescription(): void {
    if (description !== todo.description) {
      window.jot.updateTodo(todo.id, { description })
    }
  }

  function handleStatusChange(status: TodoStatus): void {
    window.jot.setStatus(todo.id, status)
  }

  function handleAddImage(): void {
    window.jot.addImage(todo.id)
  }

  function handleRemoveImage(imagePath: string): void {
    window.jot.removeImage(todo.id, imagePath)
  }

  const created = new Date(todo.createdAt)
  const completed = todo.completedAt ? new Date(todo.completedAt) : null

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <input
          className="detail-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
        />
        <button className="detail-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {category !== null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
          <span className="cat-dot" style={{ background: category.color }} />
          {category.name}
        </div>
      ) : null}

      <div className="detail-status-row">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`detail-status-btn${todo.status === opt.value ? ' active' : ''}`}
            data-status={opt.value}
            onClick={() => handleStatusChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <span className="detail-section-label">Description</span>
      <textarea
        ref={descRef}
        className="detail-description"
        placeholder="Add notes…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={saveDescription}
      />

      <span className="detail-section-label">Images</span>
      <div className="detail-images">
        {todo.images.map((rel) => {
          const absPath = imagePaths.get(rel)
          return (
            <div key={rel} className="detail-image-thumb">
              {absPath ? <img src={`file://${absPath}`} alt="" /> : null}
              <button
                className="detail-image-remove"
                onClick={() => handleRemoveImage(rel)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button className="detail-add-image" onClick={handleAddImage}>
        + Add image <span className="detail-add-image-hint">or paste</span>
      </button>

      <div className="detail-meta">
        <span>Created {created.toLocaleDateString()} {created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {completed ? (
          <span>Completed {completed.toLocaleDateString()} {completed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        ) : null}
      </div>
    </aside>
  )
}
