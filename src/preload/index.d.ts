import type { Todo } from '../renderer/src/shared/types'

interface JotBridge {
  list: () => Promise<Todo[]>
  add: (text: string) => Promise<Todo[]>
  toggle: (id: string) => Promise<Todo[]>
  remove: (id: string) => Promise<Todo[]>
  clearCompleted: () => Promise<Todo[]>
  onChanged: (callback: (todos: Todo[]) => void) => () => void
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
