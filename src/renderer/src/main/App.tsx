import { jotApi } from '../jotApiClient'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Category, JotState, Tag, Todo, TodoStatus } from '@shared/types'
import { normalize, stripTrailingHashtag, TRAILING_HASHTAG } from '@shared/hashtag'
import { parsePriority, priorityLabel } from '@shared/priority'
import { completeAtToken, dateSuggestions, parseDeadline, TRAILING_AT } from '@shared/deadline'
import { DateSuggestions } from '@shared/DateSuggestions'
import type { DateSuggestionsHandle } from '@shared/DateSuggestions'
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
  const [domainFilter, setDomainFilter] = useState<'all' | 'work' | 'private'>('all')
  const [draft, setDraft] = useState('')
  const [addSuggestionIndex, setAddSuggestionIndex] = useState(0)
  const [addDateIndex, setAddDateIndex] = useState(0)
  const dateSuggestionsRef = useRef<DateSuggestionsHandle>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // The row a manual-reorder drag is currently over, plus which edge the item
  // would land on - drives a clear insertion line so the drop position is
  // unambiguous (task 67ebdd45: "det borde vara en tydlig visuell markör på var
  // den kommer hamna"). Only set for todo-over-todo reorders, not cross-list/
  // status/band drops (those show their own droppable highlight).
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'top' | 'bottom' } | null>(null)

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
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  )

  useEffect(() => {
    let active = true
    jotApi().getState().then((initial) => {
      if (active) {
        setState(initial)
      }
    })
    const unsubscribe = jotApi().onChanged((next) => {
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

  useEffect(() => {
    // App self-update is a STANDALONE-SHELL concern (electron-updater), not part
    // of the core JotApi - it stays on window.jot. When Helm mounts this UI it
    // won't provide these, so the update toast is gated to the standalone shell.
    if (typeof window.jot?.onUpdateReady !== 'function') {
      return
    }
    const unsubscribe = window.jot.onUpdateReady((version) => {
      setUpdateVersion(version)
    })
    return unsubscribe
  }, [])

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

  // The folder bar only shows when a single real list is selected — not for
  // the "all" or "uncategorized" pseudo-filters.
  const selectedCategory = useMemo(() => {
    if (filter === 'all' || filter === 'uncategorized') {
      return null
    }
    return categoriesById.get(filter) ?? null
  }, [filter, categoriesById])

  // Subtasks live tucked under their parent (see subtasksByParent) and never
  // appear in the main flow — only root-level todos are filtered/sorted/grouped.
  const rootTodos = useMemo(() => {
    return state.todos.filter((todo) => todo.parentId === null)
  }, [state.todos])

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Todo[]>()
    for (const todo of state.todos) {
      if (todo.parentId === null) {
        continue
      }
      const existing = map.get(todo.parentId)
      if (existing === undefined) {
        map.set(todo.parentId, [todo])
      } else {
        existing.push(todo)
      }
    }
    return map
  }, [state.todos])

  const visible = useMemo(() => {
    const byCategory = rootTodos.filter((todo) => {
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

  // Active `@partial` at the end of the draft drives the date-picker dropdown,
  // mirroring how addPartial (`#`) drives the category dropdown.
  const addAtPartial = useMemo(() => {
    const match = draft.match(TRAILING_AT)
    return match !== null ? match[2] : null
  }, [draft])

  const addDateSugs = useMemo(() => {
    return addAtPartial === null ? [] : dateSuggestions(addAtPartial)
  }, [addAtPartial])

  function pickDraftDate(token: string): void {
    setDraft(completeAtToken(draft, token))
    setAddDateIndex(0)
  }

  const counts = useMemo<Counts>(() => {
    const byCategory: Record<string, number> = {}
    let all = 0
    let uncategorized = 0
    for (const todo of rootTodos) {
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
  }, [rootTodos])

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

  const selectedTodoParent = useMemo(() => {
    if (selectedTodo === null || selectedTodo.parentId === null) return null
    return state.todos.find((t) => t.id === selectedTodo.parentId) ?? null
  }, [selectedTodo, state.todos])

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
      await jotApi().addTodo(text, overrideCategoryId, prio, dl)
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
        existing !== undefined ? existing.id : await jotApi().addCategory(rawName)
      await jotApi().addTodo(text, categoryId, prio, dl)
    } else {
      const text = rawDraft.trim()
      if (text.length === 0) {
        return
      }
      const categoryId = filter === 'all' || filter === 'uncategorized' ? null : filter
      await jotApi().addTodo(text, categoryId, prio, dl)
    }
    setDraft('')
    setAddSuggestionIndex(0)
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id))
  }

  // Track the insertion point during a drag so the list can draw a line at the
  // exact spot the row will land. Cleared for anything that isn't a same-list
  // todo reorder (cross-list / status column / priority band have their own
  // highlight, so a line there would be misleading).
  function handleDragOver(event: DragOverEvent): void {
    const { active, over } = event
    if (over === null || String(active.id) === String(over.id)) {
      setDropTarget(null)
      return
    }
    const overId = String(over.id)
    if (overId.startsWith('drop:') || overId.startsWith('cat:')) {
      setDropTarget(null)
      return
    }
    const activeRect = active.rect.current.translated
    if (activeRect === null || activeRect === undefined) {
      setDropTarget(null)
      return
    }
    const activeCenter = activeRect.top + activeRect.height / 2
    const overCenter = over.rect.top + over.rect.height / 2
    setDropTarget({ id: overId, edge: activeCenter < overCenter ? 'top' : 'bottom' })
  }

  function handleDragCancel(): void {
    setActiveId(null)
    setDropTarget(null)
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setActiveId(null)
    setDropTarget(null)
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
          await jotApi().reorderCategories(newOrder)
        }
      }
      return
    }

    // Todo drag
    const todoId = draggedId

    if (overId.startsWith('drop:')) {
      const target = overId.slice('drop:'.length)
      if (target === 'uncat') {
        await jotApi().setTodoCategory(todoId, null)
        return
      }
      if (target === 'newcat') {
        const newCategoryId = await jotApi().addCategory('New list')
        await jotApi().setTodoCategory(todoId, newCategoryId)
        setEditingId(newCategoryId)
        return
      }
      if (target.startsWith('cat:')) {
        await jotApi().setTodoCategory(todoId, target.slice('cat:'.length))
        return
      }
      if (target.startsWith('status:')) {
        const status = target.slice('status:'.length) as TodoStatus
        // Land at the top of the column it was dropped into.
        await jotApi().setStatus(todoId, status, true)
        return
      }
      // A priority band lives under Open, so dropping here also opens the todo.
      if (target.startsWith('prio:')) {
        const priority = parseInt(target.slice('prio:'.length), 10)
        if (Number.isFinite(priority)) {
          await jotApi().setStatus(todoId, 'open')
          await jotApi().setTodoPriority(todoId, priority)
        }
        return
      }
      return
    }

    // Todo dropped directly onto a category row (useSortable id wins over useDroppable)
    if (overId.startsWith('cat:')) {
      await jotApi().setTodoCategory(todoId, overId.slice('cat:'.length))
      return
    }

    if (todoId !== overId) {
      // Dropped onto a task in a different priority band → adopt that priority
      // instead of reordering across the divider.
      const dragged = state.todos.find((t) => t.id === todoId)
      const target = state.todos.find((t) => t.id === overId)
      if (dragged !== undefined && target !== undefined && dragged.priority !== target.priority) {
        await jotApi().setTodoPriority(todoId, target.priority)
        return
      }
      // Reorder within the same band/list
      const oldIndex = openIds.indexOf(todoId)
      const newIndex = openIds.indexOf(overId)
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(openIds, oldIndex, newIndex)
        await jotApi().reorderTodos(newOrder)
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
        <div className="app-header-left">
          <h1>
            Jot <span className="version">v{__APP_VERSION__}</span>
          </h1>
          {selectedCategory !== null ? <FolderControl category={selectedCategory} /> : null}
        </div>
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
        onDragOver={handleDragOver}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div className="body">
          <Sidebar
            categories={state.categories}
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            onAddCategory={(name) => {
              jotApi().addCategory(name)
            }}
            onRenameCategory={(id, name) => {
              jotApi().renameCategory(id, name)
            }}
            onRemoveCategory={(id) => {
              setPendingDeleteCatId(id)
            }}
            onCycleCategoryDomain={(id, current, back) => {
              // Forward (left-click): none -> private -> work -> none. Private
              // first because it's the common case for a personal todo app.
              // Backward (right-click): the exact reverse.
              const forward =
                current === 'private' ? 'work' : current === 'work' ? null : 'private'
              const backward =
                current === 'work' ? 'private' : current === 'private' ? null : 'work'
              jotApi().setCategoryDomain(id, back ? backward : forward)
            }}
            domainFilter={domainFilter}
            onDomainFilterChange={setDomainFilter}
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
                    setAddDateIndex(0)
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
                    // Date dropdown navigation (trailing `@token`); the index
                    // past the suggestions is the "Pick a date…" calendar row.
                    if (addAtPartial !== null) {
                      const navLength = addDateSugs.length + 1
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setAddDateIndex((i) => (i + 1) % navLength)
                        return
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setAddDateIndex((i) => (i - 1 + navLength) % navLength)
                        return
                      }
                      if (event.key === 'Enter' || event.key === 'Tab') {
                        event.preventDefault()
                        const chosen = addDateSugs[addDateIndex]
                        if (chosen !== undefined) {
                          pickDraftDate(chosen.token)
                        } else {
                          dateSuggestionsRef.current?.openCalendar()
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
              ) : addAtPartial !== null ? (
                <DateSuggestions
                  ref={dateSuggestionsRef}
                  className="add-suggestions"
                  suggestions={addDateSugs}
                  activeIndex={addDateIndex}
                  onPick={(suggestion) => pickDraftDate(suggestion.token)}
                  onCalendarPick={(iso) => pickDraftDate(iso)}
                />
              ) : null}
            </div>

            {viewMode === 'board' ? (
              <BoardView
                todos={visible}
                categoriesById={categoriesById}
                tagsById={tagsById}
                subtasksByParent={subtasksByParent}
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
                                subtasks={subtasksByParent.get(todo.id) ?? []}
                                showCategoryTag={filter === 'all'}
                                editingId={editingTodoId}
                                sortable={sortMode === 'manual'}
                                dropEdge={dropTarget?.id === todo.id ? dropTarget.edge : null}
                                onSetStatus={(id, status) => jotApi().setStatus(id, status)}
                                onRemove={(id) => jotApi().removeTodo(id)}
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
                            jotApi().archiveCompleted().then((count) => {
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
                            jotApi().clearCompleted()
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
                                    jotApi().setStatus(todo.id, 'open')
                                  }}
                                />
                                <span className="todo-text">{todo.text}</span>
                              </label>
                              <button
                                className="remove-button"
                                title="Delete"
                                onClick={() => {
                                  jotApi().removeTodo(todo.id)
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
              parent={selectedTodoParent}
              subtasks={subtasksByParent.get(selectedTodo.id) ?? []}
              onSelectTodo={setSelectedTodoId}
            />
          ) : null}
        </div>

        <DragOverlay>
          {activeTodo !== null ? (
            <TodoCard todo={activeTodo} category={categoryFor(activeTodo)} />
          ) : null}
        </DragOverlay>

        {toast !== null ? <div className="copy-toast">{toast}</div> : null}

        {updateVersion !== null ? (
          <div className="update-toast">
            <span className="update-toast-text">Update ready (v{updateVersion})</span>
            <button
              className="update-toast-action"
              onClick={() => window.jot.installUpdate()}
            >
              Restart to update
            </button>
            <button
              className="update-toast-dismiss"
              title="Dismiss"
              onClick={() => setUpdateVersion(null)}
            >
              ×
            </button>
          </div>
        ) : null}
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
            jotApi().removeCategory(pendingDeleteCat.id)
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

/**
 * Monochrome folder glyph for the folder control. Uses currentColor so it
 * inherits the muted control color instead of rendering as a colorful emoji.
 */
function FolderIcon(): JSX.Element {
  return (
    <svg
      className="folder-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6L7.5 4.5H13.5C14.0523 4.5 14.5 4.94772 14.5 5.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H2.5C1.94772 13.5 1.5 13.0523 1.5 12.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Header control showing the folder associated with the currently selected
 * list (if any). Left-aligned in the header, separate from the right-side
 * button cluster — a small pick button followed by the path as plain text,
 * matching Maestro's compact repo-folder control. Muted throughout, no
 * colorful accent.
 */
function FolderControl({ category }: { category: Category }): JSX.Element {
  const repoPath = category.repoPath ?? null

  async function pickAndSet(): Promise<void> {
    const chosen = await jotApi().pickFolder(repoPath ?? undefined)
    if (chosen) {
      jotApi().setCategoryRepoPath(category.id, chosen)
    }
  }

  if (repoPath === null) {
    return (
      <button className="icon-btn folder-control-link" onClick={pickAndSet} title="Link a folder to this list">
        <FolderIcon /> Link folder
      </button>
    )
  }

  return (
    <div className="folder-control" title={repoPath}>
      <button className="icon-btn folder-control-pick" onClick={pickAndSet} title="Change folder">
        <FolderIcon />
      </button>
      <span className="folder-control-path">{repoPath}</span>
      <button
        className="folder-control-clear"
        title="Unlink folder"
        onClick={() => {
          jotApi().setCategoryRepoPath(category.id, '')
        }}
      >
        ×
      </button>
    </div>
  )
}
