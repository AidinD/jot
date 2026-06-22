import { randomUUID } from 'crypto'
import type { Todo } from '../renderer/src/shared/types'
import type { StorageAdapter } from './storage'

type ChangeListener = (todos: Todo[]) => void

/**
 * In-memory source of truth for the todo list. Loads once on startup,
 * mutates in memory, persists through the StorageAdapter, and notifies
 * subscribers (the open windows) on every change.
 */
export class TodoStore {
  private todos: Todo[] = []
  private readonly listeners = new Set<ChangeListener>()

  constructor(private readonly storage: StorageAdapter) {}

  async init(): Promise<void> {
    this.todos = await this.storage.load()
  }

  list(): Todo[] {
    return this.todos
  }

  async add(text: string): Promise<Todo[]> {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return this.todos
    }
    const todo: Todo = {
      id: randomUUID(),
      text: trimmed,
      done: false,
      createdAt: Date.now(),
      completedAt: null
    }
    // Newest items land on top, per the quick-capture flow.
    this.todos = [todo, ...this.todos]
    await this.persist()
    return this.todos
  }

  async toggle(id: string): Promise<Todo[]> {
    this.todos = this.todos.map((todo) => {
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
    return this.todos
  }

  async remove(id: string): Promise<Todo[]> {
    this.todos = this.todos.filter((todo) => {
      return todo.id !== id
    })
    await this.persist()
    return this.todos
  }

  async clearCompleted(): Promise<Todo[]> {
    this.todos = this.todos.filter((todo) => {
      return !todo.done
    })
    await this.persist()
    return this.todos
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.todos)
    for (const listener of this.listeners) {
      listener(this.todos)
    }
  }
}
