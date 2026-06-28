import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category, Tag, Todo, TodoStatus } from '@shared/types'
import { TagChips } from './TagChips'

const STATUS_CYCLE: TodoStatus[] = ['open', 'in-progress', 'review', 'done']

interface TodoItemProps {
  todo: Todo
  category: Category | null
  tagsById: Map<string, Tag>
  showCategoryTag: boolean
  editingId: string | null
  sortable: boolean
  onSetStatus: (id: string, status: TodoStatus) => void
  onRemove: (id: string) => void
  onSelect: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
}

export function TodoItem({
  todo,
  category,
  tagsById,
  showCategoryTag,
  editingId,
  sortable,
  onSetStatus,
  onRemove,
  onSelect,
  onStartEdit,
  onStopEdit
}: TodoItemProps): JSX.Element {
  const isEditing = editingId === todo.id
  // The whole row is the drag target (grabbable everywhere), so disable drag
  // while editing — otherwise selecting text in the edit input would drag.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id, disabled: !sortable || isEditing })
  const [draft, setDraft] = useState(todo.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isDone = todo.status === 'done'

  useEffect(() => {
    if (isEditing) {
      setDraft(todo.text)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [isEditing, todo.text])

  function cycleStatus(reverse: boolean = false): void {
    const currentIndex = STATUS_CYCLE.indexOf(todo.status)
    let nextIndex = currentIndex + (reverse ? -1 : 1)
    if (nextIndex < 0) nextIndex = STATUS_CYCLE.length - 1
    const nextStatus = STATUS_CYCLE[nextIndex % STATUS_CYCLE.length]
    onSetStatus(todo.id, nextStatus)
  }

  function commitEdit(): void {
    const trimmed = draft.trim()
    if (trimmed.length > 0 && trimmed !== todo.text) {
      window.jot.updateTodo(todo.id, { text: trimmed })
    }
    onStopEdit()
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }

  const rowClass = `todo-row${isDone ? ' done' : ''}`

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${rowClass}${sortable && !isEditing ? ' draggable' : ''}`}
      onClick={() => {
        if (!isEditing) {
          onSelect(todo.id)
        }
      }}
      {...attributes}
      {...listeners}
    >
      {sortable ? (
        <span className="drag-handle" title="Drag to reorder or onto a list" aria-hidden="true">
          ⠿
        </span>
      ) : (
        <span className="drag-handle placeholder" aria-hidden="true" />
      )}
      <button
        className={`status-checkbox ${todo.status}`}
        title={`Status: ${todo.status} (click to cycle)`}
        onClick={(e) => {
          e.stopPropagation()
          cycleStatus(false)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          cycleStatus(true)
        }}
      />
      {showCategoryTag && category !== null ? (
        <span className="cat-dot" style={{ background: category.color }} title={category.name} />
      ) : null}
      {isEditing ? (
        <input
          ref={inputRef}
          className="todo-edit-input"
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitEdit()
            }
            if (e.key === 'Escape') {
              onStopEdit()
            }
          }}
          onBlur={commitEdit}
        />
      ) : (
        <span
          className="todo-text"
          onDoubleClick={(e) => {
            e.stopPropagation()
            onStartEdit(todo.id)
          }}
        >
          {todo.text}
        </span>
      )}
      {!isEditing ? <TagChips tagIds={todo.tags} tagsById={tagsById} /> : null}
      <button
        className="remove-button"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          onRemove(todo.id)
        }}
      >
        ×
      </button>
    </li>
  )
}

/**
 * Static visual used inside the DragOverlay so the dragged item follows the
 * cursor at full opacity while the list item underneath dims.
 */
export function TodoCard({ todo, category }: { todo: Todo; category: Category | null }): JSX.Element {
  return (
    <div className="todo-row overlay">
      <span className="drag-handle">⠿</span>
      <button className={`status-checkbox ${todo.status}`} />
      {category !== null ? (
        <span className="cat-dot" style={{ background: category.color }} />
      ) : null}
      <span className="todo-text">{todo.text}</span>
    </div>
  )
}
