import { contextBridge, ipcRenderer } from 'electron'
import type { Todo } from '../renderer/src/shared/types'

const jotApi = {
  list: (): Promise<Todo[]> => {
    return ipcRenderer.invoke('todos:list')
  },
  add: (text: string): Promise<Todo[]> => {
    return ipcRenderer.invoke('todos:add', text)
  },
  toggle: (id: string): Promise<Todo[]> => {
    return ipcRenderer.invoke('todos:toggle', id)
  },
  remove: (id: string): Promise<Todo[]> => {
    return ipcRenderer.invoke('todos:remove', id)
  },
  clearCompleted: (): Promise<Todo[]> => {
    return ipcRenderer.invoke('todos:clearCompleted')
  },
  onChanged: (callback: (todos: Todo[]) => void): (() => void) => {
    const handler = (_event: unknown, todos: Todo[]): void => {
      callback(todos)
    }
    ipcRenderer.on('todos:changed', handler)
    return () => {
      ipcRenderer.removeListener('todos:changed', handler)
    }
  }
}

const captureApi = {
  submit: (text: string): Promise<void> => {
    return ipcRenderer.invoke('capture:submit', text)
  },
  close: (): void => {
    ipcRenderer.send('capture:close')
  },
  onReset: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on('capture:reset', handler)
    return () => {
      ipcRenderer.removeListener('capture:reset', handler)
    }
  }
}

contextBridge.exposeInMainWorld('jot', jotApi)
contextBridge.exposeInMainWorld('capture', captureApi)
