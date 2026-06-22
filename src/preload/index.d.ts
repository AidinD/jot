import type { JotState } from '../renderer/src/shared/types'

interface JotBridge {
  getState: () => Promise<JotState>
  addTodo: (text: string, categoryId: string | null) => Promise<void>
  toggleTodo: (id: string) => Promise<void>
  removeTodo: (id: string) => Promise<void>
  setTodoCategory: (id: string, categoryId: string | null) => Promise<void>
  reorderTodos: (orderedVisibleIds: string[]) => Promise<void>
  clearCompleted: () => Promise<void>
  addCategory: (name: string) => Promise<string>
  renameCategory: (id: string, name: string) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  onChanged: (callback: (state: JotState) => void) => () => void
}

interface CaptureBridge {
  submit: (text: string) => Promise<void>
  close: () => void
  onReset: (callback: () => void) => () => void
}

declare global {
  interface Window {
    jot: JotBridge
    capture: CaptureBridge
  }
}

export {}
