import { app, dialog, shell, session, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3-multiple-ciphers'
import { registerIpcHandlers, destroyDbPool } from './ipc'
import { initDatabaseManager, closeDatabaseManager } from './database'
import { mainLogger } from './services/MainLogger'
import { initAutoUpdater, scheduleUpdateChecks } from './services/AutoUpdater'
import { APP_CONFIG } from '../shared/config'

// Global error handlers — surfaces crashes that would otherwise be silent on Windows
process.on('uncaughtException', (error) => {
  mainLogger.error(`Uncaught exception: ${error.message}`, 'process')
  // Show error dialog but do NOT exit — let the app continue for non-fatal errors
  // (e.g., zlib errors from ZIP extraction should not kill the entire app)
  dialog.showErrorBox(
    'VarLens — Unexpected Error',
    `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
  )
})

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
  mainLogger.error(`Unhandled rejection: ${message}`, 'process')
  dialog.showErrorBox('VarLens — Unhandled Error', message)
})

function getAppIcon(): Electron.NativeImage {
  const iconPath = join(
    __dirname,
    process.platform === 'win32' ? '../../resources/icon.ico' : '../../resources/icon.png'
  )
  return nativeImage.createFromPath(iconPath)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: APP_CONFIG.WINDOW_WIDTH,
    height: APP_CONFIG.WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#F0F4F8',
    title: 'Varlens',
    autoHideMenuBar: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      v8CacheOptions: 'bypassHeatCheck'
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()

    // Open DevTools automatically in development
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl !== undefined && rendererUrl !== '') {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (gotTheLock !== true) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length > 0) {
      const mainWindow = allWindows[0]
      if (mainWindow.isMinimized() === true) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.varlens.app')

    // Verify better-sqlite3-multiple-ciphers works (in-memory test)
    try {
      const testDb = new Database(':memory:')
      testDb.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)')
      testDb.close()
      mainLogger.info('better-sqlite3-multiple-ciphers initialized successfully', 'database')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('NODE_MODULE_VERSION')) {
        mainLogger.error(
          'better-sqlite3-multiple-ciphers native module version mismatch.\n' +
            'The native module was compiled for a different Node.js version.\n' +
            'Fix: run "npm run rebuild:electron" to recompile for Electron.\n' +
            `Original error: ${message}`,
          'database'
        )
      } else {
        mainLogger.error(
          `Failed to initialize better-sqlite3-multiple-ciphers: ${message}`,
          'database'
        )
      }
      app.quit()
      return
    }

    // Initialize database manager with default database
    initDatabaseManager()

    // Register IPC handlers
    registerIpcHandlers()

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Set Content-Security-Policy response headers so Electron's security
    // checker sees the policy (it inspects HTTP headers, not <meta> tags).
    // In production (file:// protocol) this handler never fires — the meta
    // tag in index.html provides the CSP instead.
    // Must be registered BEFORE createWindow() so the first navigation has CSP.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws:; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
          ]
        }
      })
    })

    // Create window after security handlers are registered
    createWindow()

    // Initialize auto-updater and schedule periodic checks (deferred to avoid competing with startup)
    setImmediate(() => {
      initAutoUpdater()
      scheduleUpdateChecks()
    })

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Clean up database and worker pool on quit
  app.on('before-quit', () => {
    destroyDbPool().catch((e) => {
      mainLogger.warn(
        `DbPool destruction failed during quit: ${e instanceof Error ? e.message : String(e)}`,
        'app'
      )
    })
    closeDatabaseManager()
  })

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
