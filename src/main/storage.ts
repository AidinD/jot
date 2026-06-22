import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import type { Todo } from '../renderer/src/shared/types'

/**
 * Storage seam. v1 ships a local JSON implementation, but the rest of the
 * app only ever talks to this interface — so a future Cloudflare-backed
 * adapter (Workers + D1) can be dropped in without touching the main
 * process logic or the renderer.
 */
export interface StorageAdapter {
  load: () => Promise<Todo[]>
  save: (todos: Todo[]) => Promise<void>
}

export class LocalJsonStorage implements StorageAdapter {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), 'todos.json')
  }

  async load(): Promise<Todo[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed as Todo[]
      }
      return []
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  async save(todos: Todo[]): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(todos, null, 2), 'utf-8')
    await fs.rename(tempPath, this.filePath)
  }
}
