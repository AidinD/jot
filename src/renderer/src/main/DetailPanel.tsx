import { useEffect, useRef, useState } from 'react'
import type { Category, Tag, Todo, TodoStatus } from '@shared/types'

const STATUS_OPTIONS: { value: TodoStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
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
  tags: Tag[]
  onManageTags: () => void
  onClose: () => void
}

export function DetailPanel({
  todo,
  category,
  tags,
  onManageTags,
  onClose
}: DetailPanelProps): JSX.Element {
  const [title, setTitle] = useState(todo.text)
  const [description, setDescription] = useState(todo.description)
  const [priorityDraft, setPriorityDraft] = useState(String(todo.priority))
  const [imagePaths, setImagePaths] = useState<Map<string, string>>(new Map())
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const prevIdRef = useRef(todo.id)

  // Sync local state when the selected todo changes
  useEffect(() => {
    if (prevIdRef.current !== todo.id) {
      setTitle(todo.text)
      setDescription(todo.description)
      setPriorityDraft(String(todo.priority))
      prevIdRef.current = todo.id
    }
  }, [todo.id, todo.text, todo.description, todo.priority])

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

  // Close the image preview on Escape.
  useEffect(() => {
    if (previewSrc === null) {
      return
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setPreviewSrc(null)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [previewSrc])

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

  function toggleTag(tagId: string): void {
    const next = todo.tags.includes(tagId)
      ? todo.tags.filter((id) => id !== tagId)
      : [...todo.tags, tagId]
    window.jot.setTodoTags(todo.id, next)
  }

  function savePriority(value: string): void {
    const parsed = parseInt(value, 10)
    const next = Number.isFinite(parsed) ? parsed : 0
    setPriorityDraft(String(next))
    if (next !== todo.priority) {
      window.jot.setTodoPriority(todo.id, next)
    }
  }

  function stepPriority(delta: number): void {
    savePriority(String(todo.priority + delta))
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

      <span className="detail-section-label">Priority</span>
      <div className="detail-prio-row">
        <button
          className="prio-step"
          onClick={() => stepPriority(-1)}
          title="More important (lower number)"
        >
          −
        </button>
        <input
          className="detail-prio-input"
          type="number"
          value={priorityDraft}
          onChange={(e) => setPriorityDraft(e.target.value)}
          onBlur={() => savePriority(priorityDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
        />
        <button
          className="prio-step"
          onClick={() => stepPriority(1)}
          title="Less important (higher number)"
        >
          +
        </button>
        <span className="detail-prio-hint">0 = none · lower sorts higher</span>
      </div>

      <div className="detail-section-head">
        <span className="detail-section-label">Tags</span>
        <button className="detail-manage-tags" onClick={onManageTags}>
          Manage
        </button>
      </div>
      <div className="detail-tag-picker">
        {tags.map((tag) => {
          const active = todo.tags.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={`tag-chip${active ? ' active' : ''}`}
              style={
                active
                  ? { background: tag.color, borderColor: tag.color }
                  : { borderColor: tag.color, color: tag.color }
              }
              title={tag.description.length > 0 ? tag.description : tag.name}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          )
        })}
        {tags.length === 0 ? (
          <span className="detail-tag-empty">No tags yet — add some via Manage.</span>
        ) : null}
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
              {absPath ? (
                <img
                  src={`file://${absPath}`}
                  alt=""
                  title="Click to preview"
                  onClick={() => setPreviewSrc(`file://${absPath}`)}
                />
              ) : null}
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

      {previewSrc !== null ? (
        <div className="image-preview-overlay" onClick={() => setPreviewSrc(null)}>
          <img src={previewSrc} alt="" />
        </div>
      ) : null}
    </aside>
  )
}
