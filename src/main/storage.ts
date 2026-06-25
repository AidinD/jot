import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import type { JotState, Todo, TodoStatus } from '../renderer/src/shared/types'

/**
 * Storage seam. v1 ships a local JSON implementation, but the rest of the
 * app only ever talks to this interface — so a future Cloudflare-backed
 * adapter (Workers + D1) can be dropped in without touching the main
 * process logic or the renderer.
 */
export interface StorageAdapter {
  load: () => Promise<JotState>
  save: (state: JotState) => Promise<void>
}

function normalizeTodo(raw: any): Todo {
  let status: TodoStatus = 'open'
  if (raw.status === 'open' || raw.status === 'in-progress' || raw.status === 'done') {
    status = raw.status
  } else if (raw.done === true) {
    status = 'done'
  }

  return {
    id: String(raw.id),
    text: String(raw.text ?? ''),
    status,
    description: String(raw.description ?? ''),
    images: Array.isArray(raw.images) ? raw.images : [],
    categoryId: raw.categoryId ?? null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null
  }
}

/**
 * Accepts both the legacy v0.1 format (a bare `Todo[]`) and the current
 * `JotState` object, so existing todos.json files keep working.
 */
function migrate(parsed: unknown): JotState {
  if (Array.isArray(parsed)) {
    return {
      todos: parsed.map(normalizeTodo),
      categories: []
    }
  }
  if (parsed !== null && typeof parsed === 'object') {
    const state = parsed as Partial<JotState>
    return {
      todos: Array.isArray(state.todos) ? state.todos.map(normalizeTodo) : [],
      categories: Array.isArray(state.categories) ? state.categories : []
    }
  }
  return { todos: [], categories: [] }
}

export class LocalJsonStorage implements StorageAdapter {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), 'todos.json')
  }

  async load(): Promise<JotState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      return migrate(JSON.parse(raw))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { todos: [], categories: [] }
      }
      throw error
    }
  }

  async save(state: JotState): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    await fs.rename(tempPath, this.filePath)
  }
}
