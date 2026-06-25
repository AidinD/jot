import { useEffect, useMemo, useState } from 'react'
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
import type { Category, JotState, Todo } from '@shared/types'
import { normalize, stripTrailingHashtag, TRAILING_HASHTAG } from '@shared/hashtag'
import { Sidebar } from './Sidebar'
import type { Counts } from './Sidebar'
import { TodoCard, TodoItem } from './TodoItem'

const MAX_ADD_SUGGESTIONS = 6

const EMPTY_STATE: JotState = { todos: [], categories: [] }

export function App(): JSX.Element {
  const [state, setState] = useState<JotState>(EMPTY_STATE)
  const [filter, setFilter] = useState<string>('all')
  const [draft, setDraft] = useState('')
  const [addSuggestionIndex, setAddSuggestionIndex] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

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

  const categoriesById = useMemo(() => {
    const map = new Map<string, Category>()
    for (const category of state.categories) {
      map.set(category.id, category)
    }
    return map
  }, [state.categories])

  // Reset the filter if the selected category was deleted elsewhere.
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
    return visible.filter((todo) => {
      return !todo.done
    })
  }, [visible])

  const done = useMemo(() => {
    return visible.filter((todo) => {
      return todo.done
    })
  }, [visible])

  const openIds = useMemo(() => {
    return open.map((todo) => {
      return todo.id
    })
  }, [open])

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
      if (todo.done) {
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

  function categoryFor(todo: Todo): Category | null {
    if (todo.categoryId === null) {
      return null
    }
    return categoriesById.get(todo.categoryId) ?? null
  }

  async function handleAdd(overrideCategoryId?: string | null): Promise<void> {
    if (overrideCategoryId !== undefined) {
      // Category explicitly picked from the suggestion dropdown.
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
      // Trailing #tag typed manually — match or create the list.
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
      // No tag — land in the currently filtered list.
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
    const todoId = String(active.id)
    const overId = String(over.id)

    // Dropped onto a sidebar target → assign / create-and-assign.
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
      return
    }

    // Otherwise it is a reorder within the visible open list.
    if (todoId !== overId) {
      const oldIndex = openIds.indexOf(todoId)
      const newIndex = openIds.indexOf(overId)
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(openIds, oldIndex, newIndex)
        await window.jot.reorderTodos(newOrder)
      }
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Jot <span className="version">v{__APP_VERSION__}</span>
        </h1>
        <span className="hint">Ctrl+Alt+. anywhere</span>
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

            <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
              <ul className="todo-list">
                {open.map((todo) => {
                  return (
                    <TodoItem
                      key={todo.id}
                      todo={todo}
                      category={categoryFor(todo)}
                      showCategoryTag={filter === 'all'}
                      onToggle={(id) => {
                        window.jot.toggleTodo(id)
                      }}
                      onRemove={(id) => {
                        window.jot.removeTodo(id)
                      }}
                    />
                  )
                })}
                {open.length === 0 ? <li className="empty">Nothing open here. Nice.</li> : null}
              </ul>
            </SortableContext>

            {done.length > 0 ? (
              <section className="done-section">
                <div className="done-header">
                  <span>Completed ({done.length})</span>
                  <button
                    className="link-button"
                    onClick={() => {
                      window.jot.clearCompleted()
                    }}
                  >
                    Clear
                  </button>
                </div>
                <ul className="todo-list">
                  {done.map((todo) => {
                    return (
                      <li key={todo.id} className="todo-row done static">
                        <label className="todo-label">
                          <input
                            type="checkbox"
                            checked={todo.done}
                            onChange={() => {
                              window.jot.toggleTodo(todo.id)
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
              </section>
            ) : null}
          </main>
        </div>

        <DragOverlay>
          {activeTodo !== null ? (
            <TodoCard todo={activeTodo} category={categoryFor(activeTodo)} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
