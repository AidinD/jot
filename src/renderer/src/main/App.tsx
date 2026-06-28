import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Category, JotState, Todo, TodoStatus } from '@shared/types'
import { normalize, stripTrailingHashtag, TRAILING_HASHTAG } from '@shared/hashtag'
import { Sidebar } from './Sidebar'
import type { Counts } from './Sidebar'
import { TodoCard, TodoItem } from './TodoItem'
import { DetailPanel } from './DetailPanel'
import { BoardView } from './BoardView'

const MAX_ADD_SUGGESTIONS = 6

const EMPTY_STATE: JotState = { todos: [], categories: [] }

type SortMode = 'manual' | 'status' | 'date'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'status', label: 'Status' },
  { value: 'date', label: 'Date' }
]

// In-progress floats to the top, then open. (Done lives in its own section.)
const STATUS_RANK: Record<TodoStatus, number> = {
  'in-progress': 0,
  open: 1,
  done: 2
}

/**
 * Returns a sorted copy for the chosen mode. Manual returns the list as-is
 * (the drag order). Array sort is stable, so items keep their manual order
 * within each status group.
 */
function sortTodos(list: Todo[], mode: SortMode): Todo[] {
  if (mode === 'manual') {
    return list
  }
  const sorted = [...list]
  if (mode === 'date') {
    sorted.sort((a, b) => b.createdAt - a.createdAt)
  } else if (mode === 'status') {
    sorted.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
  }
  return sorted
}

export function App(): JSX.Element {
  const [state, setState] = useState<JotState>(EMPTY_STATE)
  const [filter, setFilter] = useState<string>('all')
  const [draft, setDraft] = useState('')
  const [addSuggestionIndex, setAddSuggestionIndex] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<'list' | 'board'>(
    () => (localStorage.getItem('jot:viewMode') as 'list' | 'board') || 'list'
  )
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem('jot:sortMode') as SortMode) || 'manual'
  )
  const [isCompletedCollapsed, setIsCompletedCollapsed] = useState<boolean>(false)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  )

  useEffect(() => {
    let active = true
    window.jot.getState().then((initial) => {
      if (active) {
        setState(initial)
      }
    })
    const unsubscribe = window.jot.onChanged((next) => {
      setState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('jot:viewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem('jot:sortMode', sortMode)
  }, [sortMode])

  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(timer)
  }, [toast])

  const categoriesById = useMemo(() => {
    const map = new Map<string, Category>()
    for (const category of state.categories) {
      map.set(category.id, category)
    }
    return map
  }, [state.categories])

  useEffect(() => {
    if (filter === 'all' || filter === 'uncategorized') {
      return
    }
    if (!categoriesById.has(filter)) {
      setFilter('all')
    }
  }, [filter, categoriesById])

  const visible = useMemo(() => {
    return state.todos.filter((todo) => {
      if (filter === 'all') {
        return true
      }
      if (filter === 'uncategorized') {
        return todo.categoryId === null
      }
      return todo.categoryId === filter
    })
  }, [state.todos, filter])

  const open = useMemo(() => {
    return visible.filter((todo) => todo.status !== 'done')
  }, [visible])

  const displayOpen = useMemo(() => {
    return sortTodos(open, sortMode)
  }, [open, sortMode])

  const done = useMemo(() => {
    return visible.filter((todo) => todo.status === 'done')
  }, [visible])

  const openIds = useMemo(() => {
    return displayOpen.map((todo) => {
      return todo.id
    })
  }, [displayOpen])

  const addPartial = useMemo(() => {
    const match = draft.match(TRAILING_HASHTAG)
    return match !== null ? match[1] : null
  }, [draft])

  const addSuggestions = useMemo(() => {
    if (addPartial === null) {
      return []
    }
    const needle = normalize(addPartial)
    return state.categories
      .filter((c) => {
        return needle.length === 0 || normalize(c.name).includes(needle)
      })
      .slice(0, MAX_ADD_SUGGESTIONS)
  }, [addPartial, state.categories])

  const counts = useMemo<Counts>(() => {
    const byCategory: Record<string, number> = {}
    let all = 0
    let uncategorized = 0
    for (const todo of state.todos) {
      if (todo.status === 'done') {
        continue
      }
      all += 1
      if (todo.categoryId === null) {
        uncategorized += 1
      } else {
        byCategory[todo.categoryId] = (byCategory[todo.categoryId] ?? 0) + 1
      }
    }
    return { all, uncategorized, byCategory }
  }, [state.todos])

  const activeTodo = useMemo(() => {
    if (activeId === null) {
      return null
    }
    return state.todos.find((todo) => {
      return todo.id === activeId
    }) ?? null
  }, [activeId, state.todos])

  const selectedTodo = useMemo(() => {
    if (selectedTodoId === null) return null
    return state.todos.find((t) => t.id === selectedTodoId) ?? null
  }, [selectedTodoId, state.todos])

  function categoryFor(todo: Todo): Category | null {
    if (todo.categoryId === null) {
      return null
    }
    return categoriesById.get(todo.categoryId) ?? null
  }

  async function handleAdd(overrideCategoryId?: string | null): Promise<void> {
    if (overrideCategoryId !== undefined) {
      const text = stripTrailingHashtag(draft).trim()
      if (text.length === 0) {
        return
      }
      await window.jot.addTodo(text, overrideCategoryId)
      setDraft('')
      setAddSuggestionIndex(0)
      return
    }

    const match = draft.match(TRAILING_HASHTAG)
    if (match !== null && match[1].length > 0) {
      const rawName = match[1]
      const text = stripTrailingHashtag(draft).trim()
      if (text.length === 0) {
        setDraft('')
        return
      }
      const existing = state.categories.find((c) => {
        return normalize(c.name) === normalize(rawName)
      })
      const categoryId =
        existing !== undefined ? existing.id : await window.jot.addCategory(rawName)
      await window.jot.addTodo(text, categoryId)
    } else {
      const text = draft.trim()
      if (text.length === 0) {
        return
      }
      const categoryId = filter === 'all' || filter === 'uncategorized' ? null : filter
      await window.jot.addTodo(text, categoryId)
    }
    setDraft('')
    setAddSuggestionIndex(0)
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id))
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setActiveId(null)
    const { active, over } = event
    if (over === null) {
      return
    }
    const draggedId = String(active.id)
    const overId = String(over.id)

    // Category drag: reorder or ignore. useSortable gives overId 'cat:X';
    // useDroppable gives 'drop:cat:X' — accept both since closestCenter is
    // non-deterministic when both are on the same DOM node. Early return prevents
    // categories from ever reaching the todo-drop paths below.
    if (draggedId.startsWith('cat:')) {
      const activeCatId = draggedId.slice('cat:'.length)
      let overCatId: string | null = null
      if (overId.startsWith('drop:cat:')) {
        overCatId = overId.slice('drop:cat:'.length)
      } else if (overId.startsWith('cat:')) {
        overCatId = overId.slice('cat:'.length)
      }
      if (overCatId !== null && overCatId !== activeCatId) {
        const catIds = state.categories.map((c) => c.id)
        const oldIndex = catIds.indexOf(activeCatId)
        const newIndex = catIds.indexOf(overCatId)
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const newOrder = arrayMove(catIds, oldIndex, newIndex)
          await window.jot.reorderCategories(newOrder)
        }
      }
      return
    }

    // Todo drag
    const todoId = draggedId

    if (overId.startsWith('drop:')) {
      const target = overId.slice('drop:'.length)
      if (target === 'uncat') {
        await window.jot.setTodoCategory(todoId, null)
        return
      }
      if (target === 'newcat') {
        const newCategoryId = await window.jot.addCategory('New list')
        await window.jot.setTodoCategory(todoId, newCategoryId)
        setEditingId(newCategoryId)
        return
      }
      if (target.startsWith('cat:')) {
        await window.jot.setTodoCategory(todoId, target.slice('cat:'.length))
        return
      }
      if (target.startsWith('status:')) {
        const status = target.slice('status:'.length) as TodoStatus
        await window.jot.setStatus(todoId, status)
        return
      }
      return
    }

    // Todo dropped directly onto a category row (useSortable id wins over useDroppable)
    if (overId.startsWith('cat:')) {
      await window.jot.setTodoCategory(todoId, overId.slice('cat:'.length))
      return
    }

    // Todo reorder within the same list
    if (todoId !== overId) {
      const oldIndex = openIds.indexOf(todoId)
      const newIndex = openIds.indexOf(overId)
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(openIds, oldIndex, newIndex)
        await window.jot.reorderTodos(newOrder)
      }
    }
  }

  const handleCopy = useCallback(() => {
    const lines = open.map((todo) => {
      const check = todo.status === 'in-progress' ? '/' : ' '
      const cat = todo.categoryId ? categoriesById.get(todo.categoryId) : null
      const tag = cat ? ` (#${cat.name})` : ''
      return `- [${check}] ${todo.text}${tag}`
    })
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setToast(`Copied ${open.length} tasks`)
    })
  }, [open, categoriesById])

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Jot <span className="version">v{__APP_VERSION__}</span>
        </h1>
        <div className="header-actions">
          <label className="sort-control" title="Sort the open list">
            <span className="sort-label">Sort</span>
            <select
              className="sort-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view (Simple)"
            >
              ☰ Simple
            </button>
            <button
              className={`view-toggle-btn${viewMode === 'board' ? ' active' : ''}`}
              onClick={() => setViewMode('board')}
              title="Board view (Advanced)"
            >
              ▦ Advanced
            </button>
          </div>
          <button className="icon-btn" onClick={handleCopy} title="Copy all visible tasks">
            📋
          </button>
          <span className="hint">Ctrl+Alt+. anywhere</span>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="body">
          <Sidebar
            categories={state.categories}
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            onAddCategory={(name) => {
              window.jot.addCategory(name)
            }}
            onRenameCategory={(id, name) => {
              window.jot.renameCategory(id, name)
            }}
            onRemoveCategory={(id) => {
              window.jot.removeCategory(id)
            }}
            editingId={editingId}
            setEditingId={setEditingId}
          />

          <main className="main-pane">
            <div className="add-area">
              <div className="add-row">
                <input
                  autoFocus
                  className="add-input"
                  placeholder="Add a todo… (#list to file)"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setAddSuggestionIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (addSuggestions.length > 0) {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setAddSuggestionIndex((i) => (i + 1) % addSuggestions.length)
                        return
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setAddSuggestionIndex(
                          (i) => (i - 1 + addSuggestions.length) % addSuggestions.length
                        )
                        return
                      }
                      if (event.key === 'Tab') {
                        event.preventDefault()
                        const chosen = addSuggestions[addSuggestionIndex]
                        if (chosen !== undefined) {
                          setDraft(
                            `${stripTrailingHashtag(draft)} #${normalize(chosen.name)} `.replace(
                              /^\s+/,
                              ''
                            )
                          )
                        }
                        return
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        const chosen = addSuggestions[addSuggestionIndex]
                        if (chosen !== undefined) {
                          handleAdd(chosen.id)
                        }
                        return
                      }
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleAdd()
                    }
                  }}
                />
                <button className="add-button" onClick={() => handleAdd()}>
                  Add
                </button>
              </div>

              {addSuggestions.length > 0 ? (
                <div className="add-suggestions">
                  {addSuggestions.map((category, index) => {
                    const cls = index === addSuggestionIndex ? 'suggestion active' : 'suggestion'
                    return (
                      <button
                        key={category.id}
                        className={cls}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          handleAdd(category.id)
                        }}
                      >
                        <span className="cat-dot" style={{ background: category.color }} />
                        {category.name}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>

            {viewMode === 'board' ? (
              <BoardView
                todos={visible}
                categoriesById={categoriesById}
                onSelect={setSelectedTodoId}
              />
            ) : (
              <>
                <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
                  <ul className="todo-list">
                    {displayOpen.map((todo) => {
                      return (
                        <TodoItem
                          key={todo.id}
                          todo={todo}
                          category={categoryFor(todo)}
                          showCategoryTag={filter === 'all'}
                          editingId={editingTodoId}
                          sortable={sortMode === 'manual'}
                          onSetStatus={(id, status) => window.jot.setStatus(id, status)}
                          onRemove={(id) => window.jot.removeTodo(id)}
                          onSelect={setSelectedTodoId}
                          onStartEdit={setEditingTodoId}
                          onStopEdit={() => setEditingTodoId(null)}
                        />
                      )
                    })}
                    {displayOpen.length === 0 ? (
                      <li className="empty">Nothing open here. Nice.</li>
                    ) : null}
                  </ul>
                </SortableContext>

                {done.length > 0 ? (
                  <section className="done-section">
                    <div className="done-header" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setIsCompletedCollapsed(!isCompletedCollapsed)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ transform: isCompletedCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms ease', fontSize: 10 }}>▼</span>
                        Completed ({done.length})
                      </span>
                      <button
                        className="link-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.jot.clearCompleted()
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    {!isCompletedCollapsed && (
                      <ul className="todo-list">
                        {done.map((todo) => {
                          return (
                            <li key={todo.id} className="todo-row done static">
                              <label className="todo-label">
                                <input
                                  type="checkbox"
                                  checked={todo.status === 'done'}
                                  onChange={() => {
                                    window.jot.setStatus(todo.id, 'open')
                                  }}
                                />
                                <span className="todo-text">{todo.text}</span>
                              </label>
                              <button
                                className="remove-button"
                                title="Delete"
                                onClick={() => {
                                  window.jot.removeTodo(todo.id)
                                }}
                              >
                                ×
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                ) : null}
              </>
            )}
          </main>

          {selectedTodo !== null ? (
            <DetailPanel
              todo={selectedTodo}
              category={categoryFor(selectedTodo)}
              onClose={() => setSelectedTodoId(null)}
            />
          ) : null}
        </div>

        <DragOverlay>
          {activeTodo !== null ? (
            <TodoCard todo={activeTodo} category={categoryFor(activeTodo)} />
          ) : null}
        </DragOverlay>

        {toast !== null ? <div className="copy-toast">{toast}</div> : null}
      </DndContext>
    </div>
  )
}
