import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category, Todo } from '@shared/types'

interface TodoItemProps {
  todo: Todo
  category: Category | null
  showCategoryTag: boolean
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

export function TodoItem({
  todo,
  category,
  showCategoryTag,
  onToggle,
  onRemove
}: TodoItemProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }

  return (
    <li ref={setNodeRef} style={style} className={todo.done ? 'todo-row done' : 'todo-row'}>
      <button className="drag-handle" title="Drag to reorder or onto a list" {...attributes} {...listeners}>
        ⠿
      </button>
      <label className="todo-label">
        <input
          type="checkbox"
          checked={todo.done}
          onChange={() => {
            onToggle(todo.id)
          }}
        />
        {showCategoryTag && category !== null ? (
          <span className="cat-dot" style={{ background: category.color }} title={category.name} />
        ) : null}
        <span className="todo-text">{todo.text}</span>
      </label>
      <button
        className="remove-button"
        title="Delete"
        onClick={() => {
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
      {category !== null ? (
        <span className="cat-dot" style={{ background: category.color }} />
      ) : null}
      <span className="todo-text">{todo.text}</span>
    </div>
  )
}
