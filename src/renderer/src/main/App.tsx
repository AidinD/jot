import { useEffect, useMemo, useState } from 'react'
import type { Todo } from '@shared/types'

export function App(): JSX.Element {
  const [todos, setTodos] = useState<Todo[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let active = true
    window.jot.list().then((initial) => {
      if (active) {
        setTodos(initial)
      }
    })
    const unsubscribe = window.jot.onChanged((next) => {
      setTodos(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const { open, done } = useMemo(() => {
    const openItems = todos.filter((todo) => {
      return !todo.done
    })
    const doneItems = todos.filter((todo) => {
      return todo.done
    })
    return { open: openItems, done: doneItems }
  }, [todos])

  async function handleAdd(): Promise<void> {
    const text = draft.trim()
    if (text.length === 0) {
      return
    }
    const next = await window.jot.add(text)
    setTodos(next)
    setDraft('')
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Jot</h1>
        <span className="hint">Ctrl+Alt+. anywhere</span>
      </header>

      <div className="add-row">
        <input
          autoFocus
          className="add-input"
          placeholder="Add a todo…"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={handleKeyDown}
        />
        <button className="add-button" onClick={handleAdd}>
          Add
        </button>
      </div>

      <ul className="todo-list">
        {open.map((todo) => {
          return <TodoRow key={todo.id} todo={todo} />
        })}
        {open.length === 0 ? <li className="empty">Nothing open. Nice.</li> : null}
      </ul>

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
              return <TodoRow key={todo.id} todo={todo} />
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function TodoRow({ todo }: { todo: Todo }): JSX.Element {
  return (
    <li className={todo.done ? 'todo-row done' : 'todo-row'}>
      <label className="todo-label">
        <input
          type="checkbox"
          checked={todo.done}
          onChange={() => {
            window.jot.toggle(todo.id)
          }}
        />
        <span className="todo-text">{todo.text}</span>
      </label>
      <button
        className="remove-button"
        title="Delete"
        onClick={() => {
          window.jot.remove(todo.id)
        }}
      >
        ×
      </button>
    </li>
  )
}
