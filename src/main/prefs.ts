import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface Prefs {
  autoLaunch?: boolean
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

export function loadPrefs(): Prefs {
  try {
    if (!existsSync(prefsPath())) {
      return {}
    }
    const parsed = JSON.parse(readFileSync(prefsPath(), 'utf-8').replace(/^\uFEFF/, ''))
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as Prefs
    }
    return {}
  } catch {
    return {}
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save prefs:', error)
  }
}
