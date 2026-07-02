import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Category, JotState, Tag, Todo, TodoStatus } from '@shared/types'
import { normalize, stripTrailingHashtag, TRAILING_HASHTAG } from '@shared/hashtag'
import { parsePriority, priorityLabel } from '@shared/priority'
import { parseDeadline } from '@shared/deadline'
import { Sidebar } from './Sidebar'
import type { Counts } from './Sidebar'
import { TodoCard, TodoItem } from './TodoItem'
import { DetailPanel } from './DetailPanel'
import { BoardView } from './BoardView'
import { SortMenu } from './SortMenu'
import { ConfirmModal } from './ConfirmModal'
import { TagManager } from './TagManager'
import { PriorityBand } from './PriorityBand'

const MAX_ADD_SUGGESTIONS = 6

const EMPTY_STATE: JotState = { todos: [], categories: [], tags: [] }

type SortMode = 'manual' | 'status' | 'date' | 'deadline'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'status', label: 'Status' },
  { value: 'date', label: 'Date' },
  { value: 'deadline', label: 'Deadline' }
]

// In-progress floats to the top, then open, then review (awaiting sign-off).
// Done lives in its own section.
const STATUS_RANK: Record<TodoStatus, number> = {
  'in-progress': 0,
  open: 1,
  review: 2,
  done: 3
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
  } else if (mode === 'deadline') {
    // Nearest deadline first; no-deadline tasks sink to the bottom.
    sorted.sort((a, b) => {
      if (a.deadline === null && b.deadline === null) return 0
      if (a.deadline === null) return 1
      if (b.deadline === null) return -1
      return a.deadline - b.deadline
    })
  }
  return sorted
}

/**
 * Prefer whatever droppable the pointer is actually over (sidebar lists, status
 * columns, the row under the cursor), falling back to closest-center for the
 * gaps. Plain closestCenter measured from the dragged item's center, which in
 * the list view stays closer to neighbouring rows than to the sidebar — so
 * dragging a todo onto another list never registered. Pointer-first fixes both
 * the cross-list move and the target highlight.
 */
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) {
    return pointerCollisions
  }
  return closestCenter(args)
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
  const [pendingDeleteCatId, setPendingDeleteCatId] = useState<string | null>(null)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
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

  const tagsById = useMemo(() => {
    const map = new Map<string, Tag>()
    for (const tag of state.tags) {
      map.set(tag.id, tag)
    }
    return map
  }, [state.tags])

  useEffect(() => {
    if (filter === 'all' || filter === 'uncategorized') {
      return
    }
    if (!categoriesById.has(filter)) {
      setFilter('all')
    }
  }, [filter, categoriesById])

  const visible = useMemo(() => {
    const byCategory = state.todos.filter((todo) => {
      if (filter === 'all') {
        return true
      }
      if (filter === 'uncategorized') {
        return todo.categoryId === null
      }
      return todo.categoryId === filter
    })
    const query = searchQuery.trim().toLowerCase()
    if (query.length === 0) {
      return byCategory
    }
    return byCategory.filter((todo) => {
      return (
        todo.text.toLowerCase().includes(query) || todo.description.toLowerCase().includes(query)
      )
    })
  }, [state.todos, filter, searchQuery])

  const open = useMemo(() => {
    return visible.filter((todo) => todo.status !== 'done')
  }, [visible])

  // Open todos grouped by priority (ascending — lower number sits on top), each
  // group sorted by the active sort mode. Dividers are only shown when more than
  // one priority is in play (see the render).
  const priorityGroups = useMemo(() => {
    const byPriority = new Map<number, Todo[]>()
    for (const todo of open) {
      const existing = byPriority.get(todo.priority)
      if (existing === undefined) {
        byPriority.set(todo.priority, [todo])
      } else {
        existing.push(todo)
      }
    }
    return Array.from(byPriority.keys())
      .sort((a, b) => a - b)
      .map((priority) => ({
        priority,
        todos: sortTodos(byPriority.get(priority) ?? [], sortMode)
      }))
  }, [open, sortMode])

  const displayOpen = useMemo(() => {
    return priorityGroups.flatMap((group) => group.todos)
  }, [priorityGroups])

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

  // Clicking the already-open todo closes the detail panel (toggle).
  const toggleSelectTodo = useCallback((id: string) => {
    setSelectedTodoId((prev) => (prev === id ? null : id))
  }, [])

  const pendingDeleteCat = useMemo(() => {
    if (pendingDeleteCatId === null) {
      return null
    }
    return state.categories.find((c) => c.id === pendingDeleteCatId) ?? null
  }, [pendingDeleteCatId, state.categories])

  const pendingDeleteCount = useMemo(() => {
    if (pendingDeleteCatId === null) {
      return 0
    }
    return state.todos.filter((t) => t.categoryId === pendingDeleteCatId).length
  }, [pendingDeleteCatId, state.todos])

  function categoryFor(todo: Todo): Category | null {
    if (todo.categoryId === null) {
      return null
    }
    return categoriesById.get(todo.categoryId) ?? null
  }

  async function handleAdd(overrideCategoryId?: string | null): Promise<void> {
    // Pull out a `!N` priority token and an `@token` deadline; the rest is the
    // text + #list logic.
    const { priority, text: afterPriority } = parsePriority(draft)
    const { deadline, text: rawDraft } = parseDeadline(afterPriority)
    const prio = priority ?? undefined
    const dl = deadline ?? undefined

    if (overrideCategoryId !== undefined) {
      const text = stripTrailingHashtag(rawDraft).trim()
      if (text.length === 0) {
        return
      }
      await window.jot.addTodo(text, overrideCategoryId, prio, dl)
      setDraft('')
      setAddSuggestionIndex(0)
      return
    }

    const match = rawDraft.match(TRAILING_HASHTAG)
    if (match !== null && match[1].length > 0) {
      const rawName = match[1]
      const text = stripTrailingHashtag(rawDraft).trim()
      if (text.length === 0) {
        setDraft('')
        return
      }
      const existing = state.categories.find((c) => {
        return normalize(c.name) === normalize(rawName)
      })
      const categoryId =
        existing !== undefined ? existing.id : await window.jot.addCategory(rawName)
      await window.jot.addTodo(text, categoryId, prio, dl)
    } else {
      const text = rawDraft.trim()
      if (text.length === 0) {
        return
      }
      const categoryId = filter === 'all' || filter === 'uncategorized' ? null : filter
      await window.jot.addTodo(text, categoryId, prio, dl)
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
        // Land at the top of the column it was dropped into.
        await window.jot.setStatus(todoId, status, true)
        return
      }
      // A priority band lives under Open, so dropping here also opens the todo.
      if (target.startsWith('prio:')) {
        const priority = parseInt(target.slice('prio:'.length), 10)
        if (Number.isFinite(priority)) {
          await window.jot.setStatus(todoId, 'open')
          await window.jot.setTodoPriority(todoId, priority)
        }
        return
      }
      return
    }

    // Todo dropped directly onto a category row (useSortable id wins over useDroppable)
    if (overId.startsWith('cat:')) {
      await window.jot.setTodoCategory(todoId, overId.slice('cat:'.length))
      return
    }

    if (todoId !== overId) {
      // Dropped onto a task in a different priority band → adopt that priority
      // instead of reordering across the divider.
      const dragged = state.todos.find((t) => t.id === todoId)
      const target = state.todos.find((t) => t.id === overId)
      if (dragged !== undefined && target !== undefined && dragged.priority !== target.priority) {
        await window.jot.setTodoPriority(todoId, target.priority)
        return
      }
      // Reorder within the same band/list
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
          <div className="search-control">
            <input
              className="search-input"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.length > 0 ? (
              <button
                className="search-clear"
                title="Clear search"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="sort-control" title="Sort the open list">
            <span className="sort-label">Sort</span>
            <SortMenu value={sortMode} options={SORT_OPTIONS} onChange={setSortMode} />
          </div>
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
              <path
                d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="hint">Ctrl+Alt+. anywhere</span>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
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
              setPendingDeleteCatId(id)
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
                tagsById={tagsById}
                onSelect={toggleSelectTodo}
              />
            ) : (
              <>
                <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
                  {priorityGroups.map((group) => {
                    return (
                      <PriorityBand
                        key={group.priority}
                        priority={group.priority}
                        className="priority-group"
                      >
                        {priorityGroups.length > 1 ? (
                          <div className="priority-divider">{priorityLabel(group.priority)}</div>
                        ) : null}
                        <ul className="todo-list">
                          {group.todos.map((todo) => {
                            return (
                              <TodoItem
                                key={todo.id}
                                todo={todo}
                                category={categoryFor(todo)}
                                tagsById={tagsById}
                                showCategoryTag={filter === 'all'}
                                editingId={editingTodoId}
                                sortable={sortMode === 'manual'}
                                onSetStatus={(id, status) => window.jot.setStatus(id, status)}
                                onRemove={(id) => window.jot.removeTodo(id)}
                                onSelect={toggleSelectTodo}
                                onStartEdit={setEditingTodoId}
                                onStopEdit={() => setEditingTodoId(null)}
                              />
                            )
                          })}
                        </ul>
                      </PriorityBand>
                    )
                  })}
                  {displayOpen.length === 0 ? (
                    <ul className="todo-list">
                      <li className="empty">Nothing open here. Nice.</li>
                    </ul>
                  ) : null}
                </SortableContext>

                {done.length > 0 ? (
                  <section className="done-section">
                    <div className="done-header" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setIsCompletedCollapsed(!isCompletedCollapsed)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ transform: isCompletedCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms ease', fontSize: 10 }}>▼</span>
                        Completed ({done.length})
                      </span>
                      <span style={{ display: 'flex', gap: 12 }}>
                        <button
                          className="link-button"
                          title="Move completed to archive.json (keeps history)"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.jot.archiveCompleted().then((count) => {
                              if (count > 0) {
                                setToast(`Archived ${count}`)
                              }
                            })
                          }}
                        >
                          Archive
                        </button>
                        <button
                          className="link-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.jot.clearCompleted()
                          }}
                        >
                          Clear
                        </button>
                      </span>
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
              tags={state.tags}
              onManageTags={() => setTagManagerOpen(true)}
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

      {pendingDeleteCat !== null ? (
        <ConfirmModal
          title="Delete list"
          message={
            pendingDeleteCount > 0
              ? `Delete "${pendingDeleteCat.name}" and its ${pendingDeleteCount} task${pendingDeleteCount === 1 ? '' : 's'}? This can't be undone.`
              : `Delete "${pendingDeleteCat.name}"? This can't be undone.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            window.jot.removeCategory(pendingDeleteCat.id)
            setPendingDeleteCatId(null)
          }}
          onCancel={() => setPendingDeleteCatId(null)}
        />
      ) : null}

      {tagManagerOpen ? (
        <TagManager tags={state.tags} onClose={() => setTagManagerOpen(false)} />
      ) : null}
    </div>
  )
}
