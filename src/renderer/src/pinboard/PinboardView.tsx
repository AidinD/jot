import { jotApi } from '../jotApiClient'
import { useEffect, useState } from 'react'
import type { Category, JotState, Todo, TodoStatus } from '@shared/types'
import { priorityLabel } from '@shared/priority'
import { formatDeadline, isDueToday, isOverdue } from '@shared/deadline'

const EMPTY_STATE: JotState = { todos: [], categories: [], tags: [] }

const STATUS_CYCLE: TodoStatus[] = ['open', 'in-progress', 'review', 'done']

/**
 * The desktop panel: the pinned todos, and nothing else. It is a *showcase* of
 * what you decided to get done, so it deliberately offers only the two moves
 * that belong on a desktop overlay — tick a todo along, or take it off the
 * panel. Everything else (editing, notes, subtasks) means opening the main
 * window, which a double-click on a row does.
 *
 * Pinned-ness lives on the todo, so this window holds no state of its own: the
 * main process shows and hides it purely from whether anything is pinned.
 */
export function Pinboard(): JSX.Element {
  const [state, setState] = useState<JotState>(EMPTY_STATE)

  useEffect(() => {
    jotApi()
      .getState()
      .then((loaded) => {
        setState(loaded)
      })
    return jotApi().onChanged((next) => {
      setState(next)
    })
  }, [])

  const categoriesById = new Map<string, Category>(state.categories.map((cat) => [cat.id, cat]))
  // Done todos are unpinned by the store, so a pinned todo is by definition
  // still outstanding. Lowest priority number first, matching the main list.
  const pinned = state.todos
    .filter((todo) => todo.pinned && todo.status !== 'done')
    .sort((a, b) => a.priority - b.priority)

  function cycleStatus(todo: Todo, reverse: boolean): void {
    const current = STATUS_CYCLE.indexOf(todo.status)
    const next = (current + (reverse ? -1 : 1) + STATUS_CYCLE.length) % STATUS_CYCLE.length
    jotApi().setStatus(todo.id, STATUS_CYCLE[next])
  }

  function unpin(todo: Todo): void {
    jotApi().setTodoPinned?.(todo.id, false)
  }

  return (
    <div className="pinboard">
      <header className="pinboard-header">
        <span className="pinboard-title">Pinned</span>
        <span className="pinboard-count">{pinned.length}</span>
        <button
          className="pinboard-unpin-all"
          title="Unpin all — this closes the panel"
          onClick={() => {
            for (const todo of pinned) {
              unpin(todo)
            }
          }}
        >
          ×
        </button>
      </header>

      <ul className="pinboard-list">
        {pinned.map((todo) => {
          const category = todo.categoryId ? (categoriesById.get(todo.categoryId) ?? null) : null
          return (
            <li
              key={todo.id}
              className="pinboard-row"
              onDoubleClick={() => window.jot.showMainWindow()}
              title="Double-click to open Jot"
            >
              <button
                className={`status-checkbox ${todo.status}`}
                title={`Status: ${todo.status} (click to cycle)`}
                onClick={() => cycleStatus(todo, false)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  cycleStatus(todo, true)
                }}
              />
              {category !== null ? (
                <span
                  className="cat-dot"
                  style={{ background: category.color }}
                  title={category.name}
                />
              ) : null}
              <span className="pinboard-text">{todo.text}</span>
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
              <button className="pinboard-unpin" title="Unpin" onClick={() => unpin(todo)}>
                ×
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
