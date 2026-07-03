import { useState } from 'react'
import type { Todo, TodoStatus } from '@shared/types'

const STATUS_CYCLE: TodoStatus[] = ['open', 'in-progress', 'review', 'done']

interface SubtaskListProps {
  parentId: string
  subtasks: Todo[]
  onSelect: (id: string) => void
}

/**
 * A lightweight checklist for a task's subtasks. Subtasks are full Todos with
 * the same 4-state status as any task — the checkbox cycles through it
 * (click forward, right-click back), colored the same way as the main list's
 * status-checkbox. Open the subtask itself (click its text) to edit its
 * priority/tags/deadline/description/images.
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

  function cycleStatus(subtask: Todo, reverse: boolean): void {
    const currentIndex = STATUS_CYCLE.indexOf(subtask.status)
    let nextIndex = currentIndex + (reverse ? -1 : 1)
    if (nextIndex < 0) {
      nextIndex = STATUS_CYCLE.length - 1
    }
    window.jot.setStatus(subtask.id, STATUS_CYCLE[nextIndex % STATUS_CYCLE.length])
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
                className={`status-checkbox subtask-checkbox ${subtask.status}`}
                title={`Status: ${subtask.status} (click to cycle)`}
                onClick={() => cycleStatus(subtask, false)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  cycleStatus(subtask, true)
                }}
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
