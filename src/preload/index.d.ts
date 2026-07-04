import type { JotState, TodoStatus } from '../renderer/src/shared/types'

interface JotBridge {
  getState: () => Promise<JotState>
  addTodo: (
    text: string,
    categoryId: string | null,
    priority?: number,
    deadline?: number | null
  ) => Promise<void>
  setStatus: (id: string, status: TodoStatus, toTop?: boolean) => Promise<void>
  setTodoPriority: (id: string, priority: number) => Promise<void>
  setTodoDeadline: (id: string, deadline: number | null) => Promise<void>
  addSubtask: (parentId: string, text: string) => Promise<string>
  updateTodo: (id: string, patch: { text?: string; description?: string }) => Promise<void>
  addImage: (todoId: string) => Promise<void>
  addImageData: (todoId: string, bytes: Uint8Array, ext: string) => Promise<void>
  removeImage: (todoId: string, imagePath: string) => Promise<void>
  getImagePath: (relativePath: string) => Promise<string>
  removeTodo: (id: string) => Promise<void>
  setTodoCategory: (id: string, categoryId: string | null) => Promise<void>
  reorderTodos: (orderedVisibleIds: string[]) => Promise<void>
  clearCompleted: () => Promise<void>
  archiveCompleted: () => Promise<number>
  addCategory: (name: string) => Promise<string>
  renameCategory: (id: string, name: string) => Promise<void>
  setCategoryRepoPath: (id: string, repoPath: string) => Promise<void>
  pickFolder: (defaultPath?: string) => Promise<string | null>
  removeCategory: (id: string) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  addTag: (name: string, color: string, description: string) => Promise<string>
  updateTag: (id: string, patch: { name?: string; color?: string; description?: string }) => Promise<void>
  removeTag: (id: string) => Promise<void>
  setTodoTags: (todoId: string, tagIds: string[]) => Promise<void>
  onChanged: (callback: (state: JotState) => void) => () => void
}

interface CaptureBridge {
  submit: (
    text: string,
    categoryId: string | null,
    priority?: number,
    deadline?: number | null
  ) => Promise<void>
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
