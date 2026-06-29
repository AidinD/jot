import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

interface PriorityBandProps {
  priority: number
  className: string
  children: ReactNode
}

/**
 * A droppable wrapper around a priority band. Dropping a todo here is handled in
 * App's handleDragEnd (`drop:prio:N` → open + set priority). Used in both the
 * list and board views.
 */
export function PriorityBand({ priority, className, children }: PriorityBandProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:prio:${priority}` })
  return (
    <div ref={setNodeRef} className={`${className}${isOver ? ' drop-over' : ''}`}>
      {children}
    </div>
  )
}
