import type { JotState, TodoStatus } from '../renderer/src/shared/types'

interface JotBridge {
  getState: () => Promise<JotState>
  addTodo: (text: string, categoryId: string | null) => Promise<void>
  setStatus: (id: string, status: TodoStatus) => Promise<void>
  updateTodo: (id: string, patch: { text?: string; description?: string }) => Promise<void>
  addImage: (todoId: string) => Promise<void>
  removeImage: (todoId: string, imagePath: string) => Promise<void>
  getImagePath: (relativePath: string) => Promise<string>
  removeTodo: (id: string) => Promise<void>
  setTodoCategory: (id: string, categoryId: string | null) => Promise<void>
  reorderTodos: (orderedVisibleIds: string[]) => Promise<void>
  clearCompleted: () => Promise<void>
  addCategory: (name: string) => Promise<string>
  renameCategory: (id: string, name: string) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  onChanged: (callback: (state: JotState) => void) => () => void
}

interface CaptureBridge {
  submit: (text: string, categoryId: string | null) => Promise<void>
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
