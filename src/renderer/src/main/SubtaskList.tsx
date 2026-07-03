import { useState } from 'react'
import type { Todo } from '@shared/types'

interface SubtaskListProps {
  parentId: string
  subtasks: Todo[]
  onSelect: (id: string) => void
}

/**
 * A lightweight checklist for a task's subtasks. Subtasks are full Todos
 * (they can carry their own priority/tags/deadline), but this view only shows
 * a checkbox + text + remove — open the subtask itself (click its text) to
 * edit the rest. The checkbox toggles open/done directly rather than cycling
 * the full status set, since this is meant to read as a checklist.
 */
export function SubtaskList({ parentId, subtasks, onSelect }: SubtaskListProps): JSX.Element {
  const [draft, setDraft] = useState('')

  function commitAdd(): void {
    const text = draft.trim()
    if (text.length === 0) {
      return
    }
    void window.jot.addSubtask(parentId, text)
    setDraft('')
  }

  const doneCount = subtasks.filter((s) => s.status === 'done').length

  return (
    <div className="subtask-list">
      {subtasks.length > 0 ? (
        <span className="subtask-progress">
          {doneCount}/{subtasks.length} done
        </span>
      ) : null}
      <ul className="subtask-rows">
        {subtasks.map((subtask) => {
          const done = subtask.status === 'done'
          return (
            <li key={subtask.id} className="subtask-row">
              <button
                className={`subtask-checkbox${done ? ' done' : ''}`}
                title={done ? 'Mark open' : 'Mark done'}
                onClick={() => window.jot.setStatus(subtask.id, done ? 'open' : 'done')}
              />
              <span
                className={`subtask-text${done ? ' done' : ''}`}
                onClick={() => onSelect(subtask.id)}
              >
                {subtask.text}
              </span>
              <button
                className="subtask-remove"
                title="Delete subtask"
                onClick={() => window.jot.removeTodo(subtask.id)}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <input
        className="subtask-add-input"
        placeholder="+ Add subtask"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitAdd()
          }
        }}
        onBlur={commitAdd}
      />
    </div>
  )
}
