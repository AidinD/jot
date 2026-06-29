export type TodoStatus = 'open' | 'in-progress' | 'review' | 'done'

export interface Todo {
  id: string
  text: string
  status: TodoStatus
  description: string
  images: string[]
  categoryId: string | null
  tags: string[]
  priority: number
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
 * A reusable label that can be applied to many todos. `description` is the
 * hover text shown on the tag chip.
 */
export interface Tag {
  id: string
  name: string
  color: string
  description: string
}

/**
 * The full persisted/broadcast application state. Order within `todos` is the
 * display order; reordering mutates this array.
 */
export interface JotState {
  todos: Todo[]
  categories: Category[]
  tags: Tag[]
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
  addTodo: (text: string, categoryId: string | null, priority?: number) => Promise<void>
  setStatus: (id: string, status: TodoStatus) => Promise<void>
  setTodoPriority: (id: string, priority: number) => Promise<void>
  updateTodo: (id: string, patch: { text?: string; description?: string }) => Promise<void>
  removeTodo: (id: string) => Promise<void>
  setTodoCategory: (id: string, categoryId: string | null) => Promise<void>
  reorderTodos: (orderedVisibleIds: string[]) => Promise<void>
  clearCompleted: () => Promise<void>
  archiveCompleted: () => Promise<number>
  addCategory: (name: string) => Promise<string>
  renameCategory: (id: string, name: string) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  addTag: (name: string, color: string, description: string) => Promise<string>
  updateTag: (id: string, patch: { name?: string; color?: string; description?: string }) => Promise<void>
  removeTag: (id: string) => Promise<void>
  setTodoTags: (todoId: string, tagIds: string[]) => Promise<void>
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
  submit: (text: string, categoryId: string | null, priority?: number) => Promise<void>
  close: () => void
}
