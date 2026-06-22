import { contextBridge, ipcRenderer } from 'electron'
import type { JotState } from '../renderer/src/shared/types'

const jotApi = {
  getState: (): Promise<JotState> => {
    return ipcRenderer.invoke('state:get')
  },
  addTodo: (text: string, categoryId: string | null): Promise<void> => {
    return ipcRenderer.invoke('todos:add', text, categoryId)
  },
  toggleTodo: (id: string): Promise<void> => {
    return ipcRenderer.invoke('todos:toggle', id)
  },
  removeTodo: (id: string): Promise<void> => {
    return ipcRenderer.invoke('todos:remove', id)
  },
  setTodoCategory: (id: string, categoryId: string | null): Promise<void> => {
    return ipcRenderer.invoke('todos:setCategory', id, categoryId)
  },
  reorderTodos: (orderedVisibleIds: string[]): Promise<void> => {
    return ipcRenderer.invoke('todos:reorder', orderedVisibleIds)
  },
  clearCompleted: (): Promise<void> => {
    return ipcRenderer.invoke('todos:clearCompleted')
  },
  addCategory: (name: string): Promise<string> => {
    return ipcRenderer.invoke('categories:add', name)
  },
  renameCategory: (id: string, name: string): Promise<void> => {
    return ipcRenderer.invoke('categories:rename', id, name)
  },
  removeCategory: (id: string): Promise<void> => {
    return ipcRenderer.invoke('categories:remove', id)
  },
  onChanged: (callback: (state: JotState) => void): (() => void) => {
    const handler = (_event: unknown, state: JotState): void => {
      callback(state)
    }
    ipcRenderer.on('state:changed', handler)
    return () => {
      ipcRenderer.removeListener('state:changed', handler)
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
