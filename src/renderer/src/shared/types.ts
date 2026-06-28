export type TodoStatus = 'open' | 'in-progress' | 'done'

export interface Todo {
  id: string
  text: string
  status: TodoStatus
  description: string
  images: string[]
  categoryId: string | null
  createdAt: number
  completedAt: number | null
}

export interface Category {
  id: string
  name: string
  color: string
  createdAt: number
}

/**
 * The full persisted/broadcast application state. Order within `todos` is the
 * display order; reordering mutates this array.
 */
export interface JotState {
  todos: Todo[]
  categories: Category[]
}

export type ViewMode = 'list' | 'board'

/**
 * IPC surface exposed to the main window via the preload bridge. Mutations
 * return void — the canonical state always arrives through `onChanged`, so the
 * renderer has a single source of truth. `getState` is only for the initial
 * load, and `addCategory` returns the new id so the UI can drop straight into
 * rename mode.
 */
export interface JotApi {
  getState: () => Promise<JotState>
  addTodo: (text: string, categoryId: string | null) => Promise<void>
  setStatus: (id: string, status: TodoStatus) => Promise<void>
  updateTodo: (id: string, patch: { text?: string; description?: string }) => Promise<void>
  removeTodo: (id: string) => Promise<void>
  setTodoCategory: (id: string, categoryId: string | null) => Promise<void>
  reorderTodos: (orderedVisibleIds: string[]) => Promise<void>
  clearCompleted: () => Promise<void>
  addCategory: (name: string) => Promise<string>
  renameCategory: (id: string, name: string) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  addImage: (todoId: string) => Promise<void>
  addImageData: (todoId: string, bytes: Uint8Array, ext: string) => Promise<void>
  removeImage: (todoId: string, imagePath: string) => Promise<void>
  getImagePath: (relativePath: string) => Promise<string>
  onChanged: (callback: (state: JotState) => void) => () => void
}

/**
 * Capture-window commands. The popover only submits a line and dismisses.
 */
export interface CaptureApi {
  submit: (text: string, categoryId: string | null) => Promise<void>
  close: () => void
}
