import { jotApi } from '../jotApiClient'
import { useState, type CSSProperties } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category, Tag, Todo, TodoStatus } from '@shared/types'
import { priorityLabel } from '@shared/priority'
import { formatDeadline, isOverdue, isDueToday } from '@shared/deadline'
import { emphasisFor } from '@shared/tagEmphasis'
import { PinIcon } from '@shared/PinIcon'
import { TagChips } from './TagChips'
import { PriorityBand } from './PriorityBand'
import { SubtaskList } from './SubtaskList'

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

/**
 * The ids of one column's cards in the exact order they are rendered (bands
 * flattened). Shared with App so the drag handlers reason about the SAME order
 * the user sees - board reordering used to not exist at all, so there was no
 * order to agree on (task 67ebdd45: sorting/marker were missing in board mode,
 * which is where Aidin actually sorts).
 */
export function boardColumnOrder(todos: Todo[], status: TodoStatus): string[] {
  const columnTodos = todos.filter((t) => t.status === status)
  const bands = status === 'open' ? groupByPriority(columnTodos) : null
  if (bands !== null && bands.length > 1) {
    return bands.flatMap((band) => band.todos.map((t) => t.id))
  }
  return columnTodos.map((t) => t.id)
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
  subtasksByParent: Map<string, Todo[]>
  onSelect: (id: string) => void
  dropTarget: { id: string; edge: 'top' | 'bottom' } | null
}

export function BoardView({
  todos,
  categoriesById,
  tagsById,
  subtasksByParent,
  onSelect,
  dropTarget
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
            orderedIds={boardColumnOrder(todos, col.status)}
            categoriesById={categoriesById}
            tagsById={tagsById}
            subtasksByParent={subtasksByParent}
            onSelect={onSelect}
            dropTarget={dropTarget}
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
  orderedIds,
  categoriesById,
  tagsById,
  subtasksByParent,
  onSelect,
  dropTarget
}: {
  status: TodoStatus
  label: string
  todos: Todo[]
  orderedIds: string[]
  categoriesById: Map<string, Category>
  tagsById: Map<string, Tag>
  subtasksByParent: Map<string, Todo[]>
  onSelect: (id: string) => void
  dropTarget: { id: string; edge: 'top' | 'bottom' } | null
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:status:${status}` })

  function renderCard(todo: Todo): JSX.Element {
    const cat = todo.categoryId ? categoriesById.get(todo.categoryId) ?? null : null
    return (
      <BoardCard
        key={todo.id}
        todo={todo}
        cat={cat}
        tagsById={tagsById}
        subtasks={subtasksByParent.get(todo.id) ?? []}
        onSelect={onSelect}
        dropEdge={dropTarget !== null && dropTarget.id === todo.id ? dropTarget.edge : null}
      />
    )
  }

  // Only the Open column is split into priority bands (and only when more than
  // one priority is present).
  const priorityBands = status === 'open' ? groupByPriority(todos) : null
  const showBands = priorityBands !== null && priorityBands.length > 1

  return (
    <div className="board-column">
      <div className="board-column-header" data-status={status}>
        <span>{label}</span>
        <div className="board-column-actions">
          {status === 'done' && todos.length > 0 ? (
            <>
              <button
                className="link-button"
                title="Move completed to archive.json (keeps history)"
                onClick={() => jotApi().archiveCompleted()}
              >
                Archive
              </button>
              <button className="link-button" onClick={() => jotApi().clearCompleted()}>
                Clear
              </button>
            </>
          ) : null}
          <span className="board-column-count">{todos.length}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`board-column-body${isOver ? ' drop-over' : ''}`}
      >
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
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
        </SortableContext>
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
  subtasks,
  onSelect,
  dropEdge
}: {
  todo: Todo
  cat: Category | null
  tagsById: Map<string, Tag>
  subtasks: Todo[]
  onSelect: (id: string) => void
  dropEdge: 'top' | 'bottom' | null
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // useSortable, not useDraggable: a board card must have an ORDER within its
  // column, otherwise dropping it can only change status/priority and never
  // position - which is why intra-priority sorting simply did not exist in board
  // mode (task 67ebdd45).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
    data: { type: 'todo' }
  })

  // Same whole-card marking as the list row, from the same shared rule so the
  // two views cannot drift apart.
  const emphasis = emphasisFor(todo.tags, tagsById.values())
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    ...(emphasis !== null ? { '--tag-emphasis-color': emphasis.color } : {})
  } as CSSProperties

  const hasSubtasks = subtasks.length > 0
  const subtaskDoneCount = subtasks.filter((s) => s.status === 'done').length

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`board-card${emphasis !== null ? ' tag-emphasised' : ''}${isDragging ? ' dragging' : ''}${dropEdge === 'top' ? ' drop-before' : dropEdge === 'bottom' ? ' drop-after' : ''}`}
      onClick={() => onSelect(todo.id)}
    >
      <button
        className="board-card-remove"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          jotApi().removeTodo(todo.id)
        }}
      >
        ×
      </button>
      <div className="board-card-title">{todo.text}</div>
      {hasSubtasks ? (
        <button
          className="subtask-toggle"
          title={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {expanded ? '▾' : '▸'}
          <span className="subtask-count-badge">
            {subtaskDoneCount}/{subtasks.length}
          </span>
        </button>
      ) : null}
      {expanded && hasSubtasks ? (
        <div onClick={(e) => e.stopPropagation()}>
          <SubtaskList parentId={todo.id} subtasks={subtasks} onSelect={onSelect} />
        </div>
      ) : null}
      {todo.pinned ? (
        <button
          className="card-pin"
          title="Pinned to desktop — click to unpin"
          onClick={(e) => {
            e.stopPropagation()
            jotApi().setTodoPinned?.(todo.id, false)
          }}
        >
          <PinIcon filled />
        </button>
      ) : null}
      {todo.priority !== 0 ? (
        <span className="prio-badge" title={`Priority ${todo.priority}`}>
          {priorityLabel(todo.priority)}
        </span>
      ) : null}
      {todo.deadline !== null ? (
        <span
          className={`deadline-badge${isOverdue(todo.deadline) ? ' overdue' : ''}${isDueToday(todo.deadline) ? ' due-today' : ''}`}
          title={isOverdue(todo.deadline) ? 'Overdue' : 'Deadline'}
        >
          {formatDeadline(todo.deadline)}
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
