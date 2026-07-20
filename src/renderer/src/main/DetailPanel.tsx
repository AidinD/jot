import { jotApi } from '../jotApiClient'
import { useEffect, useRef, useState } from 'react'
import type { Category, Tag, Todo, TodoStatus } from '@shared/types'
import { fromDateInputValue, toDateInputValue } from '@shared/deadline'
import { SubtaskList } from './SubtaskList'

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
  parent: Todo | null
  subtasks: Todo[]
  onSelectTodo: (id: string) => void
}

export function DetailPanel({
  todo,
  category,
  tags,
  onManageTags,
  onClose,
  parent,
  subtasks,
  onSelectTodo
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
        const abs = await jotApi().getImagePath(rel)
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
            void jotApi().addImageData(todoId, new Uint8Array(buffer), ext)
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
      jotApi().updateTodo(todo.id, { text: trimmed })
    }
  }

  function saveDescription(): void {
    if (description !== todo.description) {
      jotApi().updateTodo(todo.id, { description })
    }
  }

  function handleStatusChange(status: TodoStatus): void {
    jotApi().setStatus(todo.id, status)
  }

  function toggleTag(tagId: string): void {
    const next = todo.tags.includes(tagId)
      ? todo.tags.filter((id) => id !== tagId)
      : [...todo.tags, tagId]
    jotApi().setTodoTags(todo.id, next)
  }

  function savePriority(value: string): void {
    const parsed = parseInt(value, 10)
    const next = Number.isFinite(parsed) ? parsed : 0
    setPriorityDraft(String(next))
    if (next !== todo.priority) {
      jotApi().setTodoPriority(todo.id, next)
    }
  }

  function stepPriority(delta: number): void {
    savePriority(String(todo.priority + delta))
  }

  function handleDeadlineChange(value: string): void {
    jotApi().setTodoDeadline(todo.id, fromDateInputValue(value))
  }

  function handleAddImage(): void {
    jotApi().addImage(todo.id)
  }

  function handleRemoveImage(imagePath: string): void {
    jotApi().removeImage(todo.id, imagePath)
  }

  const created = new Date(todo.createdAt)
  const updated = new Date(todo.updatedAt)
  // Only show "Updated" when it's meaningfully after creation (a same-second value
  // is just the create, and pre-updatedAt todos default updatedAt to createdAt).
  const showUpdated = todo.updatedAt - todo.createdAt > 1000
  const completed = todo.completedAt ? new Date(todo.completedAt) : null

  return (
    <aside className="detail-panel">
      {parent !== null ? (
        <button className="detail-parent-link" onClick={() => onSelectTodo(parent.id)}>
          ↑ {parent.text}
        </button>
      ) : null}
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

      <span className="detail-section-label">Deadline</span>
      <div className="detail-deadline-row">
        <input
          className="detail-deadline-input"
          type="date"
          value={toDateInputValue(todo.deadline)}
          onChange={(e) => handleDeadlineChange(e.target.value)}
          // Clicking or focusing the field opens the calendar, not just the
          // tiny native indicator icon. showPicker() throws if called without
          // a user gesture, so guard it.
          onClick={(e) => {
            try {
              e.currentTarget.showPicker()
            } catch {
              // Ignore — the native indicator still works as a fallback.
            }
          }}
          onFocus={(e) => {
            try {
              e.currentTarget.showPicker()
            } catch {
              // Ignore — focus without a gesture (e.g. programmatic) can't open it.
            }
          }}
        />
        {todo.deadline !== null ? (
          <button className="link-button" onClick={() => jotApi().setTodoDeadline(todo.id, null)}>
            Clear
          </button>
        ) : null}
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

      {todo.parentId === null ? (
        <>
          <span className="detail-section-label">Subtasks</span>
          <SubtaskList parentId={todo.id} subtasks={subtasks} onSelect={onSelectTodo} />
        </>
      ) : null}

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
        {showUpdated ? (
          <span>Updated {updated.toLocaleDateString()} {updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        ) : null}
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
