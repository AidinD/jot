import { join } from 'path'
import { BrowserWindow, screen } from 'electron'
import { is } from '@electron-toolkit/utils'

const preloadPath = join(__dirname, '../preload/index.mjs')

function loadRoute(window: BrowserWindow, htmlFile: string): void {
  if (is.dev) {
    // Forward renderer console + load failures to the main process stdout so
    // dev issues (CSP violations, mount errors) are visible in the terminal.
    window.webContents.on('console-message', (_event, level, message) => {
      console.log(`[renderer:${htmlFile}] (${level}) ${message}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[renderer:${htmlFile}] failed to load: ${code} ${description}`)
    })
  }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${htmlFile}`)
    return
  }
  window.loadFile(join(__dirname, `../renderer/${htmlFile}`))
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 760,
    height: 660,
    minWidth: 600,
    minHeight: 440,
    show: false,
    title: 'Jot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  // Closing the main window only hides it — the app keeps living in the tray
  // so the global hotkey stays armed.
  window.on('close', (event) => {
    const app = window as BrowserWindow & { forceClose?: boolean }
    if (!app.forceClose) {
      event.preventDefault()
      window.hide()
    }
  })

  loadRoute(window, 'index.html')
  return window
}

export function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 560,
    height: 340,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Auto-dismiss if the user clicks away — keeps the popover unobtrusive.
  window.on('blur', () => {
    if (window.isVisible()) {
      window.hide()
    }
  })

  loadRoute(window, 'capture.html')
  return window
}

/**
 * Center the capture popover on the display the cursor currently sits on,
 * so it appears wherever the user is working rather than on a fixed screen.
 */
export function positionCaptureWindow(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const [winWidth, winHeight] = window.getSize()
  const targetX = Math.round(x + (width - winWidth) / 2)
  const targetY = Math.round(y + height * 0.28)
  window.setPosition(targetX, targetY)
}
