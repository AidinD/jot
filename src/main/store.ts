import { randomUUID } from 'crypto'
import type { Category, JotState, Todo } from '../renderer/src/shared/types'
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

  constructor(private readonly storage: StorageAdapter) {}

  async init(): Promise<void> {
    this.state = await this.storage.load()
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
      done: false,
      categoryId,
      createdAt: Date.now(),
      completedAt: null
    }
    // Newest items land on top, per the quick-capture flow.
    this.state.todos = [todo, ...this.state.todos]
    await this.persist()
  }

  async toggleTodo(id: string): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      const done = !todo.done
      return {
        ...todo,
        done,
        completedAt: done ? Date.now() : null
      }
    })
    await this.persist()
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
      return !todo.done
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
    this.state.categories = this.state.categories.filter((category) => {
      return category.id !== id
    })
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.categoryId !== id) {
        return todo
      }
      return { ...todo, categoryId: null }
    })
    await this.persist()
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.state)
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}
