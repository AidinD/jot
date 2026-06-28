import { appendFileSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray, dialog } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { LocalJsonStorage } from './storage'
import { TodoStore } from './store'
import { resolveDataDir, migrateLegacyData } from './data-dir'
import { loadPrefs, savePrefs } from './prefs'
import { createCaptureWindow, createMainWindow, positionCaptureWindow } from './windows'
import type { TodoStatus } from '../renderer/src/shared/types'

const CAPTURE_SHORTCUT = 'Control+Alt+.'

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let tray: Tray | null = null
let autoLaunch = true

const store = new TodoStore(new LocalJsonStorage())

function logStartup(message: string): void {
  try {
    const startupLogPath = join(app.getPath('userData'), 'startup.log')
    appendFileSync(startupLogPath, `${new Date().toISOString()} ${message}\n`, 'utf-8')
  } catch {
    // Logging must never block startup.
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', error)
  logStartup(`uncaughtException: ${String(error)}`)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason)
  logStartup(`unhandledRejection: ${String(reason)}`)
})

// Only one instance may own the global shortcut and the tray.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function showMainWindow(): void {
  if (mainWindow === null) {
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

function toggleCaptureWindow(): void {
  if (captureWindow === null) {
    return
  }
  if (captureWindow.isVisible()) {
    captureWindow.hide()
    return
  }
  positionCaptureWindow(captureWindow)
  captureWindow.show()
  captureWindow.focus()
  // Reset the input each time the popover opens.
  captureWindow.webContents.send('capture:reset')
}

function broadcastChange(): void {
  const state = store.getState()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('state:changed', state)
  }
}

function applyAutoLaunch(): void {
  // setLoginItemSettings only makes sense for the installed app; in dev it
  // would point at electron.exe, so we just persist the preference.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: autoLaunch })
  }
}

function initAutoLaunch(): void {
  const prefs = loadPrefs()
  if (prefs.autoLaunch === undefined) {
    autoLaunch = true
    savePrefs({ ...prefs, autoLaunch })
  } else {
    autoLaunch = prefs.autoLaunch
  }
  applyAutoLaunch()
}

function setAutoLaunch(value: boolean): void {
  autoLaunch = value
  savePrefs({ ...loadPrefs(), autoLaunch })
  applyAutoLaunch()
  buildTray()
}

function buildTray(): void {
  const iconPath = join(__dirname, '../../resources/tray.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    // Fall back to a blank 16x16 so the tray still mounts in dev.
    image = nativeImage.createEmpty()
  }
  if (tray === null) {
    tray = new Tray(image)
    tray.setToolTip('Jot — quick capture todos')
    tray.on('click', () => {
      showMainWindow()
    })
  }
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Jot',
      click: () => {
        showMainWindow()
      }
    },
    {
      label: 'Quick capture',
      accelerator: CAPTURE_SHORTCUT,
      click: () => {
        toggleCaptureWindow()
      }
    },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        setAutoLaunch(item.checked)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        const target = mainWindow as (BrowserWindow & { forceClose?: boolean }) | null
        if (target !== null) {
          target.forceClose = true
        }
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => {
    return store.getState()
  })
  ipcMain.handle('todos:add', (_event, text: string, categoryId: string | null) => {
    return store.addTodo(text, categoryId)
  })
  ipcMain.handle('todos:setStatus', (_event, id: string, status: TodoStatus) => {
    return store.setStatus(id, status)
  })
  ipcMain.handle('todos:update', (_event, id: string, patch: { text?: string; description?: string }) => {
    return store.updateTodo(id, patch)
  })
  ipcMain.handle('todos:addImage', async (_event, todoId: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      await store.addImage(todoId, result.filePaths[0])
    }
  })
  ipcMain.handle(
    'todos:addImageData',
    (_event, todoId: string, bytes: Uint8Array, ext: string) => {
      return store.addImageFromBytes(todoId, bytes, ext)
    }
  )
  ipcMain.handle('todos:removeImage', (_event, todoId: string, imagePath: string) => {
    return store.removeImage(todoId, imagePath)
  })
  ipcMain.handle('images:resolve', (_event, relativePath: string) => {
    return join(resolveDataDir(), relativePath)
  })
  ipcMain.handle('todos:remove', (_event, id: string) => {
    return store.removeTodo(id)
  })
  ipcMain.handle('todos:setCategory', (_event, id: string, categoryId: string | null) => {
    return store.setTodoCategory(id, categoryId)
  })
  ipcMain.handle('todos:reorder', (_event, orderedVisibleIds: string[]) => {
    return store.reorderTodos(orderedVisibleIds)
  })
  ipcMain.handle('todos:clearCompleted', () => {
    return store.clearCompleted()
  })
  ipcMain.handle('todos:archiveCompleted', () => {
    return store.archiveCompleted()
  })

  ipcMain.handle('categories:add', (_event, name: string) => {
    return store.addCategory(name)
  })
  ipcMain.handle('categories:rename', (_event, id: string, name: string) => {
    return store.renameCategory(id, name)
  })
  ipcMain.handle('categories:remove', (_event, id: string) => {
    return store.removeCategory(id)
  })
  ipcMain.handle('categories:reorder', (_event, orderedIds: string[]) => {
    return store.reorderCategories(orderedIds)
  })

  ipcMain.handle('capture:submit', async (_event, text: string, categoryId: string | null) => {
    await store.addTodo(text, categoryId)
    if (captureWindow !== null) {
      captureWindow.hide()
    }
  })
  ipcMain.on('capture:close', () => {
    if (captureWindow !== null) {
      captureWindow.hide()
    }
  })
}

app.whenReady().then(async () => {
  try {
    logStartup('app ready')
    electronApp.setAppUserModelId('io.github.aidind.jot')

    logStartup('loading store')
    migrateLegacyData()
    logStartup(`data dir ${resolveDataDir()}`)
    await store.init()
    logStartup('store loaded')
    store.subscribe(() => {
      broadcastChange()
    })

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpc()
    logStartup('ipc registered')

    mainWindow = createMainWindow()
    captureWindow = createCaptureWindow()
    logStartup('windows created')

    if (is.dev) {
      mainWindow.show()
      mainWindow.webContents.openDevTools()
    }

    initAutoLaunch()
    buildTray()
    logStartup('tray built')

    const registered = globalShortcut.register(CAPTURE_SHORTCUT, () => {
      console.log(`[shortcut] ${CAPTURE_SHORTCUT} fired`)
      logStartup(`shortcut fired ${CAPTURE_SHORTCUT}`)
      toggleCaptureWindow()
    })
    console.log(`[shortcut] register ${CAPTURE_SHORTCUT}: ${registered}`)
    console.log(`[shortcut] isRegistered: ${globalShortcut.isRegistered(CAPTURE_SHORTCUT)}`)
    logStartup(`shortcut register ${registered}`)

    app.on('activate', () => {
      showMainWindow()
    })
  } catch (error) {
    console.error('Jot failed to start', error)
    logStartup(`startup error: ${String(error)}`)
  }
})

app.on('second-instance', () => {
  showMainWindow()
})

// The app is a tray resident — do not quit when all windows are hidden.
app.on('window-all-closed', () => {
  // Intentionally left blank on all platforms; the tray keeps it alive.
})

app.on('will-quit', () => {
  store.dispose()
  globalShortcut.unregisterAll()
})
