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
    width: 1960,
    height: 988,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Jot',
    // Frameless, like Nib: the app header row IS the title bar (drag handle plus
    // its own minimise/maximise/close buttons), so the two apps read as one
    // family. backgroundColor avoids a white flash before the renderer paints.
    frame: false,
    backgroundColor: '#1b1c1f',
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

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The desktop panel for pinned todos — a small always-on-top card that sits on
 * the desktop next to whatever you're working in. Frameless with its own drag
 * strip, and off the taskbar: it's an overlay on the main window, not a second
 * app. Saved bounds win; otherwise it lands top-right of the display the cursor
 * is on, clear of the taskbar.
 */
export function createPinboardWindow(bounds?: WindowBounds): BrowserWindow {
  const window = new BrowserWindow({
    width: bounds?.width ?? 300,
    height: bounds?.height ?? 360,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 220,
    minHeight: 120,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    backgroundColor: '#1b1c1f',
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  if (bounds === undefined) {
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    const [width] = window.getSize()
    window.setPosition(area.x + area.width - width - 24, area.y + 80)
  }

  loadRoute(window, 'pinboard.html')
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
