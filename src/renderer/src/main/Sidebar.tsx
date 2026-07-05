import { useEffect, useRef, useState } from 'react'
import { useDroppable, useDndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category } from '@shared/types'

export interface Counts {
  all: number
  uncategorized: number
  byCategory: Record<string, number>
}

interface SidebarProps {
  categories: Category[]
  counts: Counts
  filter: string
  onFilter: (filter: string) => void
  onAddCategory: (name: string) => void
  onRenameCategory: (id: string, name: string) => void
  onRemoveCategory: (id: string) => void
  onCycleCategoryDomain: (id: string, current: 'work' | 'private' | undefined) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
}

export function Sidebar({
  categories,
  counts,
  filter,
  onFilter,
  onAddCategory,
  onRenameCategory,
  onRemoveCategory,
  onCycleCategoryDomain,
  editingId,
  setEditingId
}: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <PlainRow
        label="All"
        count={counts.all}
        active={filter === 'all'}
        onClick={() => {
          onFilter('all')
        }}
      />
      <DroppableRow
        droppableId="drop:uncat"
        label="Uncategorized"
        count={counts.uncategorized}
        active={filter === 'uncategorized'}
        onClick={() => {
          onFilter('uncategorized')
        }}
      />

      <div className="sidebar-heading">Lists</div>
      <SortableContext items={categories.map((c) => `cat:${c.id}`)} strategy={verticalListSortingStrategy}>
        {categories.map((category) => {
          return (
            <CategoryRow
              key={category.id}
              category={category}
              count={counts.byCategory[category.id] ?? 0}
              active={filter === category.id}
              editing={editingId === category.id}
              onClick={() => {
                onFilter(category.id)
              }}
              onStartEdit={() => {
                setEditingId(category.id)
              }}
              onRename={(name) => {
                onRenameCategory(category.id, name)
                setEditingId(null)
              }}
              onCancelEdit={() => {
                setEditingId(null)
              }}
              onRemove={() => {
                onRemoveCategory(category.id)
              }}
              onCycleDomain={() => {
                onCycleCategoryDomain(category.id, category.domain)
              }}
            />
          )
        })}
      </SortableContext>

      <NewCategoryZone />
      <AddCategoryInput onAdd={onAddCategory} />
    </aside>
  )
}

function PlainRow({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button className={active ? 'side-row active' : 'side-row'} onClick={onClick}>
      <span className="side-label">{label}</span>
      <span className="side-count">{count}</span>
    </button>
  )
}

function DroppableRow({
  droppableId,
  label,
  count,
  active,
  onClick
}: {
  droppableId: string
  label: string
  count: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })
  const className = `side-row${active ? ' active' : ''}${isOver ? ' drop-over' : ''}`
  return (
    <button ref={setNodeRef} className={className} onClick={onClick}>
      <span className="side-label">{label}</span>
      <span className="side-count">{count}</span>
    </button>
  )
}

function CategoryRow({
  category,
  count,
  active,
  editing,
  onClick,
  onStartEdit,
  onRename,
  onCancelEdit,
  onRemove,
  onCycleDomain
}: {
  category: Category
  count: number
  active: boolean
  editing: boolean
  onClick: () => void
  onStartEdit: () => void
  onRename: (name: string) => void
  onCancelEdit: () => void
  onRemove: () => void
  onCycleDomain: () => void
}): JSX.Element {
  const { setNodeRef: setSortableNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `cat:${category.id}`, data: { type: 'category' } })
  const { setNodeRef: setDroppableNodeRef } = useDroppable({ id: `drop:cat:${category.id}` })
  // This node is registered as both a sortable (`cat:X`) and a droppable
  // (`drop:cat:X`), so a dragged-over `over.id` can resolve to either. The plain
  // useDroppable isOver only matches `drop:cat:X` and so missed the highlight.
  // Read the global `over` and accept either id — but only when a TODO is being
  // dragged, not during category reorder.
  const { over, active: activeDrag } = useDndContext()
  const draggingTodo = activeDrag !== null && activeDrag.data.current?.type !== 'category'
  const isOver =
    draggingTodo && (over?.id === `cat:${category.id}` || over?.id === `drop:cat:${category.id}`)
  const [draft, setDraft] = useState(category.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(category.name)
      // requestAnimationFrame ensures focus+select fires after dnd-kit's own
      // post-drag focus cleanup, which would otherwise steal focus back.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, category.name])

  const className = `side-row category${active ? ' active' : ''}${isOver ? ' drop-over' : ''}${isDragging ? ' dragging' : ''}`
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }

  function setRefs(node: HTMLElement | null): void {
    setSortableNodeRef(node)
    setDroppableNodeRef(node)
  }

  if (editing) {
    return (
      <div ref={setRefs} style={style} className={className}>
        <span className="cat-dot" style={{ background: category.color }} />
        <input
          ref={inputRef}
          className="cat-edit-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onRename(draft)
            }
            if (event.key === 'Escape') {
              onCancelEdit()
            }
          }}
          onBlur={() => {
            onRename(draft)
          }}
        />
      </div>
    )
  }

  return (
    <div ref={setRefs} style={style} className={className}>
      <button className="side-main" onClick={onClick} onDoubleClick={onStartEdit} {...attributes} {...listeners}>
        <span className="cat-dot" style={{ background: category.color }} />
        <span className="side-label">{category.name}</span>
      </button>
      <span className="side-count">{count}</span>
      <DomainChip domain={category.domain} onClick={onCycleDomain} />
      <button className="side-action" title="Rename" onClick={onStartEdit}>
        ✎
      </button>
      <button className="side-action" title="Delete list" onClick={onRemove}>
        ×
      </button>
    </div>
  )
}

/**
 * Subtle per-list work/private classifier. Cycles work -> private -> neutral
 * on click. Deliberately understated: a small text chip, no color when unset
 * (matching the other row actions' hover-to-reveal treatment), and only a
 * muted tint (not a loud badge color) once a domain is chosen.
 */
function DomainChip({
  domain,
  onClick
}: {
  domain: 'work' | 'private' | undefined
  onClick: () => void
}): JSX.Element {
  const label = domain === 'work' ? 'W' : domain === 'private' ? 'P' : '—'
  const title =
    domain === 'work'
      ? 'Domain: Work (click for Private)'
      : domain === 'private'
        ? 'Domain: Private (click to clear)'
        : 'Domain: none (click to set Work)'
  const className = `side-action domain-chip${domain !== undefined ? ' domain-chip-set' : ''}`
  return (
    <button className={className} title={title} onClick={onClick}>
      {label}
    </button>
  )
}

function NewCategoryZone(): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop:newcat' })
  return (
    <div ref={setNodeRef} className={isOver ? 'newcat-zone over' : 'newcat-zone'}>
      ➕ Drop here for a new list
    </div>
  )
}

function AddCategoryInput({ onAdd }: { onAdd: (name: string) => void }): JSX.Element {
  const [value, setValue] = useState('')

  function commit(): void {
    const name = value.trim()
    if (name.length === 0) {
      return
    }
    onAdd(name)
    setValue('')
  }

  return (
    <input
      className="add-category-input"
      placeholder="+ New list…"
      value={value}
      onChange={(event) => {
        setValue(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}
