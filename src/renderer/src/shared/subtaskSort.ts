// Sort order for the subtask list under a task, as a view over the stored order.
//
// Intent: a task used as a reading list ("3. Radical Candor" ... "15. ...") can
// be shown oldest-first or A-Z without anyone reordering it by hand.
//
// Why it looks like this:
//   - Display only. The stored (manual) order is never rewritten, so switching
//     back to Manual always returns what the user arranged. The subtask list has
//     no drag-reorder today; if it gains one, it must be inert while a
//     non-manual order is showing, or it would reorder rows the user cannot see.
//   - The choice is kept in localStorage per parent task, not in todos.json. The
//     file is read by Tend, jot-watch and the MCP server; a UI preference is not
//     part of their contract, and it matches how the main list's sort persists.
//   - Rejected: plain localeCompare per call (slow, and "10." sorts before "9.");
//     a numeric-aware Intl.Collator in Swedish fixes both.

import type { Todo } from './types'

export type SubtaskSort = 'manual' | 'created' | 'alpha'

export const SUBTASK_SORT_OPTIONS: { value: SubtaskSort; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'created', label: 'Oldest first' },
  { value: 'alpha', label: 'A-Z' }
]

/**
 * Text compare that reads digits as numbers ("10." after "9.") and uses Swedish
 * collation, so å, ä and ö sort after z the way a Swedish reader expects.
 */
const collator = new Intl.Collator('sv', { numeric: true, sensitivity: 'base' })

export function compareSubtaskText(a: string, b: string): number {
  return collator.compare(a, b)
}

/**
 * Returns the subtasks in the chosen order. This is a view only: it returns a
 * copy and never touches the stored order. Array sort is stable, so ties (equal
 * text, or equal createdAt) keep their manual position.
 */
export function sortSubtasks(subtasks: Todo[], mode: SubtaskSort): Todo[] {
  if (mode === 'manual') {
    return subtasks
  }
  const sorted = [...subtasks]
  if (mode === 'created') {
    sorted.sort((a, b) => a.createdAt - b.createdAt)
  } else {
    sorted.sort((a, b) => compareSubtaskText(a.text, b.text))
  }
  return sorted
}

const STORAGE_PREFIX = 'jot:subtaskSort:'

export function isSubtaskSort(value: unknown): value is SubtaskSort {
  return value === 'manual' || value === 'created' || value === 'alpha'
}

/** Per-parent choice lives in this window's localStorage, not in todos.json. */
export function loadSubtaskSort(parentId: string): SubtaskSort {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + parentId)
    return isSubtaskSort(stored) ? stored : 'manual'
  } catch {
    return 'manual'
  }
}

export function saveSubtaskSort(parentId: string, mode: SubtaskSort): void {
  try {
    if (mode === 'manual') {
      localStorage.removeItem(STORAGE_PREFIX + parentId)
    } else {
      localStorage.setItem(STORAGE_PREFIX + parentId, mode)
    }
  } catch {
    // Storage unavailable: the choice just lasts until the list unmounts.
  }
}
