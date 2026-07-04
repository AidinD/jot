import { contextBridge, ipcRenderer } from 'electron'
import type { JotState, TodoStatus } from '../renderer/src/shared/types'

const jotApi = {
  getState: (): Promise<JotState> => {
    return ipcRenderer.invoke('state:get')
  },
  addTodo: (
    text: string,
    categoryId: string | null,
    priority?: number,
    deadline?: number | null
  ): Promise<void> => {
    return ipcRenderer.invoke('todos:add', text, categoryId, priority, deadline)
  },
  setStatus: (id: string, status: TodoStatus, toTop?: boolean): Promise<void> => {
    return ipcRenderer.invoke('todos:setStatus', id, status, toTop)
  },
  setTodoPriority: (id: string, priority: number): Promise<void> => {
    return ipcRenderer.invoke('todos:setPriority', id, priority)
  },
  setTodoDeadline: (id: string, deadline: number | null): Promise<void> => {
    return ipcRenderer.invoke('todos:setDeadline', id, deadline)
  },
  addSubtask: (parentId: string, text: string): Promise<string> => {
    return ipcRenderer.invoke('todos:addSubtask', parentId, text)
  },
  updateTodo: (id: string, patch: { text?: string; description?: string }): Promise<void> => {
    return ipcRenderer.invoke('todos:update', id, patch)
  },
  addImage: (todoId: string): Promise<void> => {
    return ipcRenderer.invoke('todos:addImage', todoId)
  },
  addImageData: (todoId: string, bytes: Uint8Array, ext: string): Promise<void> => {
    return ipcRenderer.invoke('todos:addImageData', todoId, bytes, ext)
  },
  removeImage: (todoId: string, imagePath: string): Promise<void> => {
    return ipcRenderer.invoke('todos:removeImage', todoId, imagePath)
  },
  getImagePath: (relativePath: string): Promise<string> => {
    return ipcRenderer.invoke('images:resolve', relativePath)
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
  archiveCompleted: (): Promise<number> => {
    return ipcRenderer.invoke('todos:archiveCompleted')
  },
  addCategory: (name: string): Promise<string> => {
    return ipcRenderer.invoke('categories:add', name)
  },
  renameCategory: (id: string, name: string): Promise<void> => {
    return ipcRenderer.invoke('categories:rename', id, name)
  },
  setCategoryRepoPath: (id: string, repoPath: string): Promise<void> => {
    return ipcRenderer.invoke('categories:setRepoPath', id, repoPath)
  },
  pickFolder: (defaultPath?: string): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:pickFolder', defaultPath)
  },
  removeCategory: (id: string): Promise<void> => {
    return ipcRenderer.invoke('categories:remove', id)
  },
  reorderCategories: (orderedIds: string[]): Promise<void> => {
    return ipcRenderer.invoke('categories:reorder', orderedIds)
  },
  addTag: (name: string, color: string, description: string): Promise<string> => {
    return ipcRenderer.invoke('tags:add', name, color, description)
  },
  updateTag: (
    id: string,
    patch: { name?: string; color?: string; description?: string }
  ): Promise<void> => {
    return ipcRenderer.invoke('tags:update', id, patch)
  },
  removeTag: (id: string): Promise<void> => {
    return ipcRenderer.invoke('tags:remove', id)
  },
  setTodoTags: (todoId: string, tagIds: string[]): Promise<void> => {
    return ipcRenderer.invoke('todos:setTags', todoId, tagIds)
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
  submit: (
    text: string,
    categoryId: string | null,
    priority?: number,
    deadline?: number | null
  ): Promise<void> => {
    return ipcRenderer.invoke('capture:submit', text, categoryId, priority, deadline)
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
