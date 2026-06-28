import { randomUUID } from 'crypto'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join, extname } from 'path'
import type { Category, JotState, Todo, TodoStatus } from '../renderer/src/shared/types'
import type { StorageAdapter } from './storage'

type ChangeListener = (state: JotState) => void

// Category accent palette, assigned round-robin as categories are created.
const CATEGORY_COLORS = [
  '#6f9cff',
  '#5fd0a0',
  '#ffb054',
  '#ff7a90',
  '#b98cff',
  '#4fc3d9',
  '#f4d35e',
  '#9aa6ff'
]

/**
 * In-memory source of truth. Loads once on startup, mutates in memory,
 * persists through the StorageAdapter, and notifies subscribers (open
 * windows) on every change.
 */
export class TodoStore {
  private state: JotState = { todos: [], categories: [] }
  private readonly listeners = new Set<ChangeListener>()
  private stopWatching: (() => void) | null = null
  private reloadInFlight: Promise<void> | null = null
  private reloadQueued = false

  constructor(private readonly storage: StorageAdapter) {}

  async init(): Promise<void> {
    this.state = await this.storage.load()
    await this.storage.save(this.state)
    if (this.storage.watch !== undefined) {
      try {
        this.stopWatching = this.storage.watch(() => {
          void this.reloadFromDisk()
        })
      } catch (error) {
        console.error('Failed to start storage watch', error)
        this.stopWatching = null
      }
    }
  }

  getState(): JotState {
    return this.state
  }

  async addTodo(text: string, categoryId: string | null): Promise<void> {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return
    }
    const todo: Todo = {
      id: randomUUID(),
      text: trimmed,
      status: 'open' as const,
      description: '',
      images: [],
      categoryId,
      createdAt: Date.now(),
      completedAt: null
    }
    // Newest items land on top, per the quick-capture flow.
    this.state.todos = [todo, ...this.state.todos]
    await this.persist()
  }

  async setStatus(id: string, status: TodoStatus): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return {
        ...todo,
        status,
        completedAt: status === 'done' ? Date.now() : null
      }
    })
    await this.persist()
  }

  async updateTodo(id: string, patch: { text?: string; description?: string }): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      const text = patch.text !== undefined ? patch.text.trim() : todo.text
      if (text.length === 0) {
        return todo
      }
      return {
        ...todo,
        text,
        description: patch.description !== undefined ? patch.description : todo.description
      }
    })
    await this.persist()
  }

  async addImage(todoId: string, sourcePath: string): Promise<string> {
    const ext = extname(sourcePath)
    const fileName = `${randomUUID()}${ext}`
    const relativePath = join('jot-images', todoId, fileName)
    const absolutePath = join(app.getPath('userData'), relativePath)

    await fs.mkdir(dirname(absolutePath), { recursive: true })
    await fs.copyFile(sourcePath, absolutePath)

    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== todoId) {
        return todo
      }
      return {
        ...todo,
        images: [...todo.images, relativePath]
      }
    })
    await this.persist()
    return relativePath
  }

  async removeImage(todoId: string, imagePath: string): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== todoId) {
        return todo
      }
      return {
        ...todo,
        images: todo.images.filter((p) => p !== imagePath)
      }
    })
    await this.persist()

    const absolutePath = join(app.getPath('userData'), imagePath)
    try {
      await fs.unlink(absolutePath)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        console.error('Failed to remove image', err)
      }
    }
  }

  async removeTodo(id: string): Promise<void> {
    this.state.todos = this.state.todos.filter((todo) => {
      return todo.id !== id
    })
    await this.persist()
  }

  async setTodoCategory(id: string, categoryId: string | null): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return { ...todo, categoryId }
    })
    await this.persist()
  }

  /**
   * Reorder the todos that are currently visible to the user, preserving the
   * positions of every todo that is not part of the visible set. The renderer
   * passes the visible ids in their new order; non-visible todos stay put.
   */
  async reorderTodos(orderedVisibleIds: string[]): Promise<void> {
    const visible = new Set(orderedVisibleIds)
    const byId = new Map(this.state.todos.map((todo) => {
      return [todo.id, todo]
    }))
    const newSequence = orderedVisibleIds
      .map((id) => {
        return byId.get(id)
      })
      .filter((todo): todo is Todo => {
        return todo !== undefined
      })

    let cursor = 0
    this.state.todos = this.state.todos.map((todo) => {
      if (!visible.has(todo.id)) {
        return todo
      }
      const replacement = newSequence[cursor]
      cursor += 1
      return replacement
    })
    await this.persist()
  }

  async clearCompleted(): Promise<void> {
    this.state.todos = this.state.todos.filter((todo) => {
      return todo.status !== 'done'
    })
    await this.persist()
  }

  async addCategory(name: string): Promise<string> {
    const category: Category = {
      id: randomUUID(),
      name: name.trim().length > 0 ? name.trim() : 'New list',
      color: CATEGORY_COLORS[this.state.categories.length % CATEGORY_COLORS.length],
      createdAt: Date.now()
    }
    this.state.categories = [...this.state.categories, category]
    await this.persist()
    return category.id
  }

  async renameCategory(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }
    this.state.categories = this.state.categories.map((category) => {
      if (category.id !== id) {
        return category
      }
      return { ...category, name: trimmed }
    })
    await this.persist()
  }

  /**
   * Remove a category. Its todos are not deleted — they fall back to
   * uncategorized so nothing is lost.
   */
  async removeCategory(id: string): Promise<void> {
    this.state.categories = this.state.categories.filter((cat) => cat.id !== id)
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.categoryId !== id) {
        return todo
      }
      return { ...todo, categoryId: null }
    })
    await this.persist()
  }

  async reorderCategories(orderedIds: string[]): Promise<void> {
    const existing = new Map(this.state.categories.map((c) => [c.id, c]))
    const newOrder: Category[] = []
    for (const id of orderedIds) {
      const cat = existing.get(id)
      if (cat !== undefined) {
        newOrder.push(cat)
        existing.delete(id)
      }
    }
    // Append any that weren't in the ordered list just in case
    for (const cat of existing.values()) {
      newOrder.push(cat)
    }
    this.state.categories = newOrder
    await this.persist()
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.stopWatching !== null) {
      this.stopWatching()
      this.stopWatching = null
    }
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.state)
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  private async reloadFromDisk(): Promise<void> {
    if (this.reloadInFlight !== null) {
      this.reloadQueued = true
      return this.reloadInFlight
    }

    this.reloadInFlight = (async () => {
      try {
        const loaded = await this.storage.load()
        if (JSON.stringify(loaded) === JSON.stringify(this.state)) {
          return
        }
        this.state = loaded
        this.notify()
      } catch (error) {
        console.error('Failed to reload Jot state from disk', error)
      } finally {
        this.reloadInFlight = null
        if (this.reloadQueued) {
          this.reloadQueued = false
          void this.reloadFromDisk()
        }
      }
    })()

    return this.reloadInFlight
  }
}
