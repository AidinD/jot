import { useDroppable, useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Category, Tag, Todo, TodoStatus } from '@shared/types'
import { priorityLabel } from '@shared/priority'
import { TagChips } from './TagChips'
import { PriorityBand } from './PriorityBand'

/** Group todos by priority, ascending (lower number first). */
function groupByPriority(todos: Todo[]): { priority: number; todos: Todo[] }[] {
  const byPriority = new Map<number, Todo[]>()
  for (const todo of todos) {
    const existing = byPriority.get(todo.priority)
    if (existing === undefined) {
      byPriority.set(todo.priority, [todo])
    } else {
      existing.push(todo)
    }
  }
  return Array.from(byPriority.keys())
    .sort((a, b) => a - b)
    .map((priority) => ({ priority, todos: byPriority.get(priority) ?? [] }))
}

const COLUMNS: { status: TodoStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in-progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' }
]

interface BoardViewProps {
  todos: Todo[]
  categoriesById: Map<string, Category>
  tagsById: Map<string, Tag>
  onSelect: (id: string) => void
}

export function BoardView({
  todos,
  categoriesById,
  tagsById,
  onSelect
}: BoardViewProps): JSX.Element {
  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const columnTodos = todos.filter((t) => t.status === col.status)
        return (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            todos={columnTodos}
            categoriesById={categoriesById}
            tagsById={tagsById}
            onSelect={onSelect}
          />
        )
      })
      }
    </div>
  )
}

function BoardColumn({
  status,
  label,
  todos,
  categoriesById,
  tagsById,
  onSelect
}: {
  status: TodoStatus
  label: string
  todos: Todo[]
  categoriesById: Map<string, Category>
  tagsById: Map<string, Tag>
  onSelect: (id: string) => void
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:status:${status}` })

  function renderCard(todo: Todo): JSX.Element {
    const cat = todo.categoryId ? categoriesById.get(todo.categoryId) ?? null : null
    return <BoardCard key={todo.id} todo={todo} cat={cat} tagsById={tagsById} onSelect={onSelect} />
  }

  // Only the Open column is split into priority bands (and only when more than
  // one priority is present).
  const priorityBands = status === 'open' ? groupByPriority(todos) : null
  const showBands = priorityBands !== null && priorityBands.length > 1

  return (
    <div className="board-column">
      <div className="board-column-header" data-status={status}>
        <span>{label}</span>
        <span className="board-column-count">{todos.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`board-column-body${isOver ? ' drop-over' : ''}`}
      >
        {showBands && priorityBands !== null
          ? priorityBands.map((band) => {
              return (
                <PriorityBand key={band.priority} priority={band.priority} className="board-prio-band">
                  <div className="priority-divider">{priorityLabel(band.priority)}</div>
                  {band.todos.map((todo) => renderCard(todo))}
                </PriorityBand>
              )
            })
          : todos.map((todo) => renderCard(todo))}
        {todos.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px', textAlign: 'center' }}>
            No tasks
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BoardCard({
  todo,
  cat,
  tagsById,
  onSelect
}: {
  todo: Todo
  cat: Category | null
  tagsById: Map<string, Tag>
  onSelect: (id: string) => void
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: todo.id,
    data: { type: 'todo' }
  })
  
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
  } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`board-card${isDragging ? ' dragging' : ''}`}
      onClick={() => onSelect(todo.id)}
    >
      <div className="board-card-title">{todo.text}</div>
      {todo.priority !== 0 ? (
        <span className="prio-badge" title={`Priority ${todo.priority}`}>
          {priorityLabel(todo.priority)}
        </span>
      ) : null}
      <TagChips tagIds={todo.tags} tagsById={tagsById} />
      <div className="board-card-meta">
        {cat ? (
          <>
            <span className="cat-dot" style={{ background: cat.color }} />
            <span>{cat.name}</span>
          </>
        ) : null}
        {todo.images.length > 0 ? <span>📷 {todo.images.length}</span> : null}
      </div>
      {todo.description ? (
        <div className="board-card-desc">{todo.description}</div>
      ) : null}
    </div>
  )
}
