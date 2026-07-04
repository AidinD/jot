import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join, extname } from 'path'
import { resolveDataDir } from './data-dir'
import type { Category, JotState, Tag, Todo, TodoStatus } from '../renderer/src/shared/types'
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
  private state: JotState = { todos: [], categories: [], tags: [] }
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

  async addTodo(
    text: string,
    categoryId: string | null,
    priority = 0,
    deadline: number | null = null
  ): Promise<void> {
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
      tags: [],
      priority: Math.trunc(priority),
      deadline,
      parentId: null,
      createdAt: Date.now(),
      completedAt: null
    }
    // Newest items land on top, per the quick-capture flow.
    this.state.todos = [todo, ...this.state.todos]
    await this.persist()
  }

  /**
   * A subtask is a regular todo with `parentId` set, inheriting the parent's
   * category. Nesting is one level deep — the parent must not itself be a
   * subtask (the caller/UI is responsible for only offering this on root todos).
   */
  async addSubtask(parentId: string, text: string): Promise<string> {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return ''
    }
    const parent = this.state.todos.find((todo) => todo.id === parentId)
    const subtask: Todo = {
      id: randomUUID(),
      text: trimmed,
      status: 'open' as const,
      description: '',
      images: [],
      categoryId: parent?.categoryId ?? null,
      tags: [],
      priority: 0,
      deadline: null,
      parentId,
      createdAt: Date.now(),
      completedAt: null
    }
    this.state.todos = [subtask, ...this.state.todos]
    await this.persist()
    return subtask.id
  }

  async setStatus(id: string, status: TodoStatus, toTop = false): Promise<void> {
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
    // When moved via a column drag, land at the top of the new column (front of
    // the array, so it sorts first among its new status/band).
    if (toTop) {
      const index = this.state.todos.findIndex((todo) => todo.id === id)
      if (index > 0) {
        const next = [...this.state.todos]
        const [moved] = next.splice(index, 1)
        next.unshift(moved)
        this.state.todos = next
      }
    }
    await this.persist()
  }

  async setTodoPriority(id: string, priority: number): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return { ...todo, priority: Math.trunc(priority) }
    })
    await this.persist()
  }

  async setTodoDeadline(id: string, deadline: number | null): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return { ...todo, deadline }
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
    return this.storeImage(todoId, extname(sourcePath), (absolutePath) => {
      return fs.copyFile(sourcePath, absolutePath)
    })
  }

  async addImageFromBytes(todoId: string, bytes: Uint8Array, ext: string): Promise<string> {
    return this.storeImage(todoId, ext, (absolutePath) => {
      return fs.writeFile(absolutePath, Buffer.from(bytes))
    })
  }

  /**
   * Shared image-attach path: pick a unique filename under jot-images/<todoId>/,
   * let the caller write the bytes (copy a file, or dump pasted bytes), then
   * record the relative path on the todo and persist.
   */
  private async storeImage(
    todoId: string,
    ext: string,
    writeFile: (absolutePath: string) => Promise<void>
  ): Promise<string> {
    const fileName = `${randomUUID()}${ext}`
    const relativePath = join('jot-images', todoId, fileName)
    const absolutePath = join(resolveDataDir(), relativePath)

    await fs.mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath)

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

    const absolutePath = join(resolveDataDir(), imagePath)
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
    // Removing a task also removes its subtasks (one level deep, so a single
    // pass is enough — subtasks cannot have their own subtasks).
    this.state.todos = this.state.todos.filter((todo) => {
      return todo.id !== id && todo.parentId !== id
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
    const doneIds = new Set(
      this.state.todos.filter((todo) => todo.status === 'done').map((todo) => todo.id)
    )
    this.state.todos = this.state.todos.filter((todo) => {
      if (todo.status === 'done') {
        return false
      }
      // A subtask whose parent just got cleared would otherwise be orphaned
      // (invisible forever — the main flow only shows root todos).
      if (todo.parentId !== null && doneIds.has(todo.parentId)) {
        return false
      }
      return true
    })
    await this.persist()
  }

  /**
   * Move completed todos out of the active list into archive.json (newest
   * first), so the working file stays small without losing history. Unlike
   * clearCompleted this preserves the data. Returns how many were archived.
   */
  async archiveCompleted(): Promise<number> {
    const doneIds = new Set(
      this.state.todos.filter((todo) => todo.status === 'done').map((todo) => todo.id)
    )
    // Cascade: subtasks of a done parent are archived alongside it (even if not
    // themselves done), so archiving a finished task never orphans its subtasks.
    const completed = this.state.todos.filter((todo) => {
      return doneIds.has(todo.id) || (todo.parentId !== null && doneIds.has(todo.parentId))
    })
    if (completed.length === 0) {
      return 0
    }

    const archivePath = join(resolveDataDir(), 'archive.json')
    let archived: (Todo & { archivedAt?: number })[] = []
    try {
      const raw = await fs.readFile(archivePath, 'utf-8')
      const parsed = JSON.parse(raw.replace(/^﻿/, ''))
      if (Array.isArray(parsed)) {
        archived = parsed
      } else if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.todos)) {
        archived = parsed.todos
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    const stamped = completed.map((todo) => ({ ...todo, archivedAt: Date.now() }))
    const next = [...stamped, ...archived]

    await fs.mkdir(dirname(archivePath), { recursive: true })
    const tempPath = `${archivePath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify({ todos: next }, null, 2), 'utf-8')
    await fs.rename(tempPath, archivePath)

    const archivedIds = new Set(completed.map((todo) => todo.id))
    this.state.todos = this.state.todos.filter((todo) => !archivedIds.has(todo.id))
    await this.persist()
    return completed.length
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
   * Set (or clear) the absolute folder path a list is associated with. An empty
   * or whitespace-only path clears the association (field is dropped). This is
   * what lets external consumers map a session's working directory to a list
   * deterministically instead of fuzzy name-matching.
   */
  async setCategoryRepoPath(id: string, repoPath: string): Promise<void> {
    const trimmed = repoPath.trim()
    this.state.categories = this.state.categories.map((category) => {
      if (category.id !== id) {
        return category
      }
      if (trimmed.length === 0) {
        // Drop the field entirely rather than store an empty string, so a
        // cleared association is indistinguishable from one never set.
        const { repoPath: _dropped, ...rest } = category
        return rest
      }
      return { ...category, repoPath: trimmed }
    })
    await this.persist()
  }

  /**
   * Remove a category AND delete every todo filed under it. This is
   * destructive — the renderer must confirm with the user first (see the
   * delete-list warning prompt in Sidebar).
   */
  async removeCategory(id: string): Promise<void> {
    this.state.categories = this.state.categories.filter((cat) => cat.id !== id)
    this.state.todos = this.state.todos.filter((todo) => todo.categoryId !== id)
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

  async addTag(name: string, color: string, description: string): Promise<string> {
    const tag: Tag = {
      id: randomUUID(),
      name: name.trim().length > 0 ? name.trim() : 'New tag',
      color,
      description: description.trim()
    }
    this.state.tags = [...this.state.tags, tag]
    await this.persist()
    return tag.id
  }

  async updateTag(
    id: string,
    patch: { name?: string; color?: string; description?: string }
  ): Promise<void> {
    this.state.tags = this.state.tags.map((tag) => {
      if (tag.id !== id) {
        return tag
      }
      const name = patch.name !== undefined ? patch.name.trim() : tag.name
      return {
        ...tag,
        name: name.length > 0 ? name : tag.name,
        color: patch.color !== undefined ? patch.color : tag.color,
        description: patch.description !== undefined ? patch.description.trim() : tag.description
      }
    })
    await this.persist()
  }

  /**
   * Remove a tag definition and strip its id from every todo that carried it.
   */
  async removeTag(id: string): Promise<void> {
    this.state.tags = this.state.tags.filter((tag) => tag.id !== id)
    this.state.todos = this.state.todos.map((todo) => {
      if (!todo.tags.includes(id)) {
        return todo
      }
      return { ...todo, tags: todo.tags.filter((tagId) => tagId !== id) }
    })
    await this.persist()
  }

  async setTodoTags(todoId: string, tagIds: string[]): Promise<void> {
    const known = new Set(this.state.tags.map((tag) => tag.id))
    const cleaned = tagIds.filter((tagId) => known.has(tagId))
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== todoId) {
        return todo
      }
      return { ...todo, tags: cleaned }
    })
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
