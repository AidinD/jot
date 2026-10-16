import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join, extname } from 'path'
import type { ArchivedTodo, Category, JotState, Tag, TagEmphasis, Todo, TodoStatus } from './types'
import { writeFileAtomic, type StorageAdapter } from './storage'

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
  // How many saves are currently on their way to disk, and whether a watch event
  // arrived while one was. See reloadFromDisk() for why a reload must never run
  // in that window.
  private pendingWrites = 0
  private reloadDeferred = false
  // Bumped once per save. A reload compares it across its own read to detect a
  // save that started and finished while the read was in flight.
  private writeSeq = 0

  // dataDir: the absolute data directory (for image + archive paths), injected
  // by the shell so core stays electron-free (the shell owns data-dir resolution).
  constructor(
    private readonly storage: StorageAdapter,
    private readonly dataDir: string
  ) {}

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
      pinned: false,
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      pinned: false,
      parentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
        // Finishing a todo takes it off the desktop panel: the pinned set is a
        // live "what's left today" shortlist, so it empties itself as you tick
        // things off instead of needing a separate unpin step.
        pinned: status === 'done' ? false : todo.pinned,
        updatedAt: Date.now(),
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
      return { ...todo, priority: Math.trunc(priority), updatedAt: Date.now() }
    })
    await this.persist()
  }

  async setTodoDeadline(id: string, deadline: number | null): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return { ...todo, deadline, updatedAt: Date.now() }
    })
    await this.persist()
  }

  /**
   * Pin/unpin a todo onto the desktop panel. Deliberately does NOT touch
   * `updatedAt`: pinning is a view choice about where a todo is shown, not a
   * change to the todo itself, and it would otherwise churn the "date" sort.
   */
  async setTodoPinned(id: string, pinned: boolean): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return { ...todo, pinned }
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
        description: patch.description !== undefined ? patch.description : todo.description,
        updatedAt: Date.now()
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
    const absolutePath = join(this.dataDir, relativePath)

    await fs.mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath)

    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== todoId) {
        return todo
      }
      return {
        ...todo,
        images: [...todo.images, relativePath],
        updatedAt: Date.now()
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
        images: todo.images.filter((p) => p !== imagePath),
        updatedAt: Date.now()
      }
    })
    await this.persist()

    const absolutePath = join(this.dataDir, imagePath)
    try {
      await fs.unlink(absolutePath)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        console.error('Failed to remove image', err)
      }
    }
    // Removing the last image of a todo left an empty jot-images/<id>/ dir
    // behind forever - nothing ever revisits it once the todo has no images
    // left to point at it. Clean it up here too, not just on removeTodo,
    // since a todo that keeps existing but loses all its images hits the
    // same leak.
    await this.removeImageDirIfEmpty(todoId)
  }

  /** Deletes jot-images/<todoId>/ if it exists and is now empty. Best-effort. */
  private async removeImageDirIfEmpty(todoId: string): Promise<void> {
    const dirPath = join(this.dataDir, 'jot-images', todoId)
    try {
      const entries = await fs.readdir(dirPath)
      if (entries.length === 0) {
        await fs.rmdir(dirPath)
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        console.error('Failed to clean up empty image dir', err)
      }
    }
  }

  async removeTodo(id: string): Promise<void> {
    // Removing a task also removes its subtasks (one level deep, so a single
    // pass is enough — subtasks cannot have their own subtasks).
    const removedIds = this.state.todos
      .filter((todo) => todo.id === id || todo.parentId === id)
      .map((todo) => todo.id)
    this.state.todos = this.state.todos.filter((todo) => {
      return todo.id !== id && todo.parentId !== id
    })
    await this.persist()

    // A removed todo's (and its subtasks') jot-images/<id>/ dir has no other
    // owner and nothing else will ever delete it - without this, every
    // deleted card that ever had an image leaks its files on disk forever
    // (found 2026-08-04: 128 orphaned dirs, 8+ MB, going back a long time).
    await Promise.all(
      removedIds.map(async (removedId) => {
        const dirPath = join(this.dataDir, 'jot-images', removedId)
        try {
          await fs.rm(dirPath, { recursive: true, force: true })
        } catch (e) {
          console.error('Failed to remove image dir for deleted todo', e)
        }
      })
    )
  }

  async setTodoCategory(id: string, categoryId: string | null): Promise<void> {
    this.state.todos = this.state.todos.map((todo) => {
      if (todo.id !== id) {
        return todo
      }
      return { ...todo, categoryId, updatedAt: Date.now() }
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

  // Archive mutations run one at a time. Each of them reads the board, reads
  // archive.json, writes archive.json and only then updates state - two awaits
  // during which the board still shows the card being archived. A second click
  // in that window recomputed the same card from unchanged state and wrote it
  // again: archive.json held 123 duplicated ids before this, including a batch
  // of 122 written twice in one sweep and a card whose two copies are stamped
  // 2.6 seconds apart. The window is wide because the file is megabytes and
  // sits in a synced folder, so an atomic write there takes seconds.
  private archiveQueue: Promise<unknown> = Promise.resolve()

  private runSerialised<T>(work: () => Promise<T>): Promise<T> {
    const run = this.archiveQueue.then(work, work)
    // Swallowed only for the queue's own chain; the caller still sees the throw.
    this.archiveQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private get archivePath(): string {
    return join(this.dataDir, 'archive.json')
  }

  /**
   * Read archive.json. Tolerates both shapes the file has had - a bare array
   * and { todos: [...] } - and a UTF-8 BOM, because it is a file on disk that
   * other tools may have written, not a structure this process owns.
   */
  private async loadArchive(): Promise<ArchivedTodo[]> {
    try {
      const raw = await fs.readFile(this.archivePath, 'utf-8')
      const parsed = JSON.parse(raw.replace(/^﻿/, ''))
      const list = Array.isArray(parsed)
        ? parsed
        : parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.todos)
          ? parsed.todos
          : []
      const valid = list.filter((todo: unknown): todo is ArchivedTodo => {
        return todo !== null && typeof todo === 'object' && typeof (todo as Todo).id === 'string'
      })
      // Collapse repeated ids, keeping the newest copy. archive.json has 123
      // duplicated ids as of 2026-10-16, most of them from a sweep in the days
      // before anything could read the file - so nothing ever surfaced them.
      // Without this the archive lists a card twice and restoring it puts two
      // identical cards back on the board.
      const newestById = new Map<string, ArchivedTodo>()
      for (const todo of valid) {
        const held = newestById.get(todo.id)
        if (held === undefined || (todo.archivedAt ?? 0) > (held.archivedAt ?? 0)) {
          newestById.set(todo.id, todo)
        }
      }
      return [...newestById.values()]
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  private async saveArchive(todos: ArchivedTodo[]): Promise<void> {
    await writeFileAtomic(this.archivePath, JSON.stringify({ todos }, null, 2))
  }

  /**
   * Everything that has left the active board, newest first. The reason the
   * archive is readable at all: without this, archiving is indistinguishable
   * from deleting, so nobody archives and the board grows forever.
   */
  async readArchive(): Promise<ArchivedTodo[]> {
    return this.loadArchive()
  }

  /**
   * Move the given todos out of the active list and into archive.json, newest
   * first. Shared by archiveCompleted and archiveTodo so the cascade rule and
   * the file format have exactly one implementation.
   */
  private async archiveTodos(ids: Set<string>): Promise<number> {
    // Cascade: subtasks of an archived parent go with it (even if not themselves
    // done), so archiving a task never orphans its subtasks.
    const leaving = this.state.todos.filter((todo) => {
      return ids.has(todo.id) || (todo.parentId !== null && ids.has(todo.parentId))
    })
    if (leaving.length === 0) {
      return 0
    }

    const archivedAt = Date.now()
    const archived = await this.loadArchive()
    await this.saveArchive([...leaving.map((todo) => ({ ...todo, archivedAt })), ...archived])

    const leavingIds = new Set(leaving.map((todo) => todo.id))
    this.state.todos = this.state.todos.filter((todo) => !leavingIds.has(todo.id))
    await this.persist()
    return leaving.length
  }

  /**
   * Move completed todos out of the active list into archive.json, so the
   * working file stays small without losing history. Unlike clearCompleted
   * this preserves the data. Returns how many were archived.
   */
  async archiveCompleted(): Promise<number> {
    return this.runSerialised(() => {
      const doneIds = new Set(
        this.state.todos.filter((todo) => todo.status === 'done').map((todo) => todo.id)
      )
      return this.archiveTodos(doneIds)
    })
  }

  /**
   * Archive one todo and its subtasks. Deliberately not restricted to done
   * todos: the caller picked this card, and a board is cleared one finished
   * thread at a time more often than in a sweep.
   */
  async archiveTodo(id: string): Promise<number> {
    return this.runSerialised(() => this.archiveTodos(new Set([id])))
  }

  /**
   * Bring one archived todo, and anything archived under it, back onto the
   * board. This is what makes archiving safe to do: a thread that goes quiet
   * for a month and then answers can be picked up where it was left.
   *
   * Returns how many todos came back; 0 if the id is not in the archive.
   */
  async restoreFromArchive(id: string): Promise<number> {
    return this.runSerialised(() => this.restoreOne(id))
  }

  private async restoreOne(id: string): Promise<number> {
    const archived = await this.loadArchive()
    const returning = archived.filter((todo) => todo.id === id || todo.parentId === id)
    if (returning.length === 0) {
      return 0
    }

    const returningIds = new Set(returning.map((todo) => todo.id))
    const live = new Set(this.state.todos.map((todo) => todo.id))
    const restored = returning.map(({ archivedAt: _archivedAt, ...todo }) => {
      // The parent may have been deleted, or may still be archived, while this
      // todo was away. Landing it at top level keeps it visible; keeping a
      // dangling parentId would restore it into nothing.
      const parentFound =
        todo.parentId !== null && (live.has(todo.parentId) || returningIds.has(todo.parentId))
      return { ...todo, parentId: parentFound ? todo.parentId : null }
    })

    await this.saveArchive(archived.filter((todo) => !returningIds.has(todo.id)))
    this.state.todos = [...this.state.todos, ...restored]
    await this.persist()
    return restored.length
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
   * Set (or clear) the work/private domain a list is classified as. `null` (or
   * any value other than 'work'/'private') clears the field entirely, so "no
   * domain" is one canonical state rather than a lingering invalid value.
   */
  async setCategoryDomain(id: string, domain: 'work' | 'private' | null): Promise<void> {
    this.state.categories = this.state.categories.map((category) => {
      if (category.id !== id) {
        return category
      }
      if (domain !== 'work' && domain !== 'private') {
        const { domain: _dropped, ...rest } = category
        return rest
      }
      return { ...category, domain }
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

  async addTag(
    name: string,
    color: string,
    description: string,
    emphasis: TagEmphasis | null = null
  ): Promise<string> {
    const tag: Tag = {
      id: randomUUID(),
      name: name.trim().length > 0 ? name.trim() : 'New tag',
      color,
      description: description.trim(),
      emphasis
    }
    this.state.tags = [...this.state.tags, tag]
    await this.persist()
    return tag.id
  }

  async updateTag(
    id: string,
    patch: { name?: string; color?: string; description?: string; emphasis?: TagEmphasis | null }
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
        description: patch.description !== undefined ? patch.description.trim() : tag.description,
        emphasis: patch.emphasis !== undefined ? patch.emphasis : tag.emphasis
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
      return { ...todo, tags: cleaned, updatedAt: Date.now() }
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
    // Every mutation applies to this.state first and calls persist() with no
    // await in between, so incrementing here (synchronously) means there is no
    // instant where an unsaved change is invisible to reloadFromDisk().
    this.pendingWrites++
    this.writeSeq++
    try {
      await this.storage.save(this.state)
    } finally {
      this.pendingWrites--
    }
    this.notify()
    // A watch event that arrived mid-write was deferred; now that disk and memory
    // agree, run it - it may still carry a genuine external change.
    if (this.pendingWrites === 0 && this.reloadDeferred) {
      this.reloadDeferred = false
      void this.reloadFromDisk()
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  private async reloadFromDisk(): Promise<void> {
    // A reload replaces this.state wholesale with what is on disk. If one of our
    // own saves has not landed yet, that file is one revision behind memory, and
    // reloading would silently revert the change the user just made - the status
    // move, the tag, the reorder. The file watcher fires on our OWN writes too, so
    // this is not a rare interleaving: any save slow enough to still be in flight
    // 150ms later (a Windows lock retry, a Dropbox-synced folder, a loaded
    // machine) hits it. Defer instead: persist() re-runs the reload once the file
    // and memory agree.
    if (this.pendingWrites > 0) {
      this.reloadDeferred = true
      return
    }

    if (this.reloadInFlight !== null) {
      this.reloadQueued = true
      return this.reloadInFlight
    }

    this.reloadInFlight = (async () => {
      try {
        const seq = this.writeSeq
        const loaded = await this.storage.load()
        // A save started while we were reading the file, so this snapshot may be
        // one revision behind memory - assigning it would revert that change.
        // Throw the read away and queue another one (the finally block below
        // re-runs us), which converges as soon as the writes stop.
        if (this.pendingWrites > 0 || this.writeSeq !== seq) {
          this.reloadQueued = true
          return
        }
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
