import { useDroppable } from '@dnd-kit/core'
import type { Category, Todo, TodoStatus } from '@shared/types'

const COLUMNS: { status: TodoStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in-progress', label: 'In Progress' },
  { status: 'done', label: 'Done' }
]

interface BoardViewProps {
  todos: Todo[]
  categoriesById: Map<string, Category>
  onSelect: (id: string) => void
}

export function BoardView({ todos, categoriesById, onSelect }: BoardViewProps): JSX.Element {
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
  onSelect
}: {
  status: TodoStatus
  label: string
  todos: Todo[]
  categoriesById: Map<string, Category>
  onSelect: (id: string) => void
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:status:${status}` })
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
        {todos.map((todo) => {
          const cat = todo.categoryId ? categoriesById.get(todo.categoryId) ?? null : null
          return (
            <div
              key={todo.id}
              className="board-card"
              onClick={() => onSelect(todo.id)}
            >
              <div className="board-card-title">{todo.text}</div>
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
        })}
        {todos.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px', textAlign: 'center' }}>
            No tasks
          </div>
        ) : null}
      </div>
    </div>
  )
}
