import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Where Jot keeps user-facing data (todos.json and image attachments).
 *
 * Default: Electron's userData folder (`%APPDATA%/jot` on Windows) — the normal,
 * portable location, so a fresh install Just Works on any machine with no setup.
 *
 * Override: set the JOT_DATA_DIR environment variable to relocate the data. This
 * is per-machine configuration, NOT baked into the app, so distributed copies
 * stay portable. Use it to put the data on a synced folder (Dropbox) or anywhere
 * an external tool can reach it without filesystem virtualization getting in the
 * way (e.g. a sandboxed assistant whose writes to %APPDATA% land in a private
 * overlay the app never sees).
 */
export function resolveDataDir(): string {
  const override = process.env.JOT_DATA_DIR
  if (override !== undefined && override.trim().length > 0) {
    return override.trim()
  }
  return app.getPath('userData')
}

/**
 * When JOT_DATA_DIR points somewhere other than the default userData folder and
 * that destination has no todos.json yet, copy the existing data over once. Runs
 * on every startup but is a no-op afterwards, so it never clobbers newer data.
 *
 * This runs inside the (non-sandboxed) main process, so it reads the app's real
 * userData file even if an external sandboxed tool cannot.
 */
export function migrateLegacyData(): void {
  const dataDir = resolveDataDir()
  const legacyDir = app.getPath('userData')

  if (dataDir === legacyDir) {
    return
  }

  const destTodos = join(dataDir, 'todos.json')
  if (existsSync(destTodos)) {
    return
  }

  const legacyTodos = join(legacyDir, 'todos.json')
  if (!existsSync(legacyTodos)) {
    return
  }

  try {
    mkdirSync(dataDir, { recursive: true })
    copyFileSync(legacyTodos, destTodos)
    copyDirIfPresent(join(legacyDir, 'jot-images'), join(dataDir, 'jot-images'))
  } catch (error) {
    console.error('Failed to migrate Jot data to JOT_DATA_DIR', error)
  }
}

function copyDirIfPresent(source: string, destination: string): void {
  if (!existsSync(source)) {
    return
  }
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry)
    const destPath = join(destination, entry)
    if (statSync(sourcePath).isDirectory()) {
      copyDirIfPresent(sourcePath, destPath)
    } else {
      copyFileSync(sourcePath, destPath)
    }
  }
}
