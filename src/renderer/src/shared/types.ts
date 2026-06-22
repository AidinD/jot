export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
  completedAt: number | null
}

/**
 * The IPC surface exposed to the renderer via the preload bridge.
 * Keeping it in shared/ lets both the preload typings and the React
 * code reference one source of truth.
 */
export interface JotApi {
  list: () => Promise<Todo[]>
  add: (text: string) => Promise<Todo[]>
  toggle: (id: string) => Promise<Todo[]>
  remove: (id: string) => Promise<Todo[]>
  clearCompleted: () => Promise<Todo[]>
  onChanged: (callback: (todos: Todo[]) => void) => () => void
}

/**
 * Capture-window specific commands. The popover only needs to submit a
 * line and dismiss itself; it never renders the full list.
 */
export interface CaptureApi {
  submit: (text: string) => Promise<void>
  close: () => void
}
