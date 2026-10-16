import { useCallback, useEffect, useMemo, useState } from 'react'
import { jotApi } from '../jotApiClient'
import type { ArchivedTodo, Category } from '../../../core/types'

/*
 * The window into archive.json.
 *
 * It exists so that archiving is not deleting. The store could move finished
 * cards into archive.json from the first version and nothing could ever read
 * them back, so the honest choice was between a board that grows forever and a
 * sweep that feels like destroying the record. Neither is a choice anyone makes
 * willingly, which is why the board was never swept.
 *
 * Read-only apart from Restore, deliberately. Editing an archived card would
 * make this a second board with its own rules; bringing it back onto the one
 * board and editing it there keeps a single place where work is worked.
 *
 * Rejected: a dedicated sidebar section that switches the main list. The archive
 * is consulted rarely and always with a question in mind ("what did we say to
 * them?"), which is a search, not a place to live - and a sidebar entry competes
 * for attention with the categories, which is where attention belongs.
 */

interface ArchiveViewProps {
  categories: Category[]
  onClose: () => void
}

function formatDay(at: number): string {
  // sv-SE renders YYYY-MM-DD, which sorts and reads the same for everyone.
  return new Date(at).toLocaleDateString('sv-SE')
}

export function ArchiveView({ categories, onClose }: ArchiveViewProps): JSX.Element {
  const [items, setItems] = useState<ArchivedTodo[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = useCallback((): void => {
    jotApi()
      .readArchive()
      .then((archived) => {
        setItems(archived)
        setFailure(null)
      })
      .catch((error: unknown) => {
        // archive.json is a file on disk that other tools may have written, so a
        // read can genuinely fail. Saying so beats an empty list that looks like
        // an empty archive.
        setFailure(error instanceof Error ? error.message : String(error))
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const categoryName = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category.name]))
    return (id: string | null): string | null => (id === null ? null : (byId.get(id) ?? null))
  }, [categories])

  const roots = useMemo(() => {
    const all = items ?? []
    const needle = query.trim().toLowerCase()
    const parents = all.filter((todo) => todo.parentId === null)
    const subtasksOf = new Map<string, ArchivedTodo[]>()
    for (const todo of all) {
      if (todo.parentId !== null) {
        subtasksOf.set(todo.parentId, [...(subtasksOf.get(todo.parentId) ?? []), todo])
      }
    }
    // A subtask whose parent is not in the archive is shown as its own row,
    // otherwise restoring it would be impossible from here.
    const parentIds = new Set(parents.map((todo) => todo.id))
    const orphans = all.filter((todo) => todo.parentId !== null && !parentIds.has(todo.parentId))

    return [...parents, ...orphans]
      .map((todo) => ({ todo, subtasks: subtasksOf.get(todo.id) ?? [] }))
      .filter(({ todo, subtasks }) => {
        if (needle.length === 0) {
          return true
        }
        const haystack = [
          todo.text,
          todo.description,
          categoryName(todo.categoryId) ?? '',
          ...subtasks.map((subtask) => subtask.text)
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      })
      .sort((a, b) => b.todo.archivedAt - a.todo.archivedAt)
  }, [items, query, categoryName])

  function restore(id: string): void {
    setRestoring(id)
    jotApi()
      .restoreFromArchive(id)
      .then(() => {
        load()
      })
      .finally(() => {
        setRestoring(null)
      })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal archive-view"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">Archive</h2>

        <input
          className="search-input archive-search"
          placeholder="Search the archive…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />

        {failure !== null ? (
          <p className="archive-empty">Could not read archive.json: {failure}</p>
        ) : items === null ? (
          <p className="archive-empty">Reading archive.json…</p>
        ) : roots.length === 0 ? (
          <p className="archive-empty">
            {items.length === 0 ? 'Nothing archived yet.' : 'Nothing matches that.'}
          </p>
        ) : (
          <div className="archive-list">
            {roots.map(({ todo, subtasks }) => (
              <div key={todo.id} className="archive-row">
                <div className="archive-row-main">
                  <span className="archive-row-text">{todo.text}</span>
                  <span className="archive-row-meta">
                    {formatDay(todo.archivedAt)}
                    {categoryName(todo.categoryId) !== null
                      ? ` · ${categoryName(todo.categoryId)}`
                      : ''}
                    {subtasks.length > 0
                      ? ` · ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}`
                      : ''}
                  </span>
                </div>
                <button
                  className="link-button"
                  title="Put this card, and anything archived under it, back on the board"
                  disabled={restoring === todo.id}
                  onClick={() => restore(todo.id)}
                >
                  {restoring === todo.id ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
