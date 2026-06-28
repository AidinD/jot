import { promises as fs, watch as watchFs } from 'fs'
import { basename, dirname, join } from 'path'
import { resolveDataDir } from './data-dir'
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
  watch?: (onChange: () => void) => () => void
}

// Repairs UTF-8 bytes that were stored as Latin-1 codepoints (double-encoding).
// Matches 0xC2/0xC3 followed by a continuation byte 0x80-0xBF — the exact pattern
// produced when U+0080-U+00FF characters have their UTF-8 bytes misread as Latin-1.
function repairDoubleEncoding(str: string): string {
  return str.replace(/[\u00c2\u00c3][\u0080-\u00bf]/g, (pair) => {
    const hi = pair.charCodeAt(0)
    const lo = pair.charCodeAt(1)
    return String.fromCharCode(((hi & 0x1f) << 6) | (lo & 0x3f))
  })
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
    text: repairDoubleEncoding(String(raw.text ?? '')),
    status,
    description: repairDoubleEncoding(String(raw.description ?? '')),
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
      categories: Array.isArray(state.categories)
        ? state.categories.map((c) => ({ ...c, name: repairDoubleEncoding(String(c.name ?? '')) }))
        : []
    }
  }
  return { todos: [], categories: [] }
}

export class LocalJsonStorage implements StorageAdapter {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(resolveDataDir(), 'todos.json')
  }

  async load(): Promise<JotState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      return migrate(JSON.parse(raw.replace(/^\uFEFF/, '')))
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

  watch(onChange: () => void): () => void {
    const directoryPath = dirname(this.filePath)
    const targetFile = basename(this.filePath)
    let closed = false
    let debounceTimer: NodeJS.Timeout | null = null

    void fs.mkdir(directoryPath, { recursive: true }).catch((error) => {
      console.error('Failed to prepare watch directory', error)
    })

    let watcher
    try {
      watcher = watchFs(directoryPath, (_eventType, filename) => {
        if (closed) {
          return
        }
        if (filename !== undefined && filename !== null) {
          const observedName = String(filename)
          if (observedName !== targetFile) {
            return
          }
        }
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer)
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          onChange()
        }, 150)
      })
    } catch (error) {
      console.error('Failed to watch Jot storage file', error)
      return () => {}
    }

    return () => {
      closed = true
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      watcher.close()
    }
  }
}
