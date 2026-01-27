import { app, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { registerIpcHandlers } from './ipc'
import { closeDatabaseService } from './database'

// Global error handlers — surfaces crashes that would otherwise be silent on Windows
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  dialog.showErrorBox(
    'VarLens — Unexpected Error',
    `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
  )
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
  dialog.showErrorBox('VarLens — Unhandled Error', message)
})

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'Varlens',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
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

    // Verify better-sqlite3 works (in-memory test)
    try {
      const testDb = new Database(':memory:')
      testDb.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)')
      testDb.close()
      console.log('better-sqlite3 initialized successfully')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('NODE_MODULE_VERSION')) {
        console.error(
          'better-sqlite3 native module version mismatch.\n' +
            'The native module was compiled for a different Node.js version.\n' +
            'Fix: run "npm run rebuild:electron" to recompile for Electron.\n' +
            `Original error: ${message}`
        )
      } else {
        console.error('Failed to initialize better-sqlite3:', message)
      }
      app.quit()
      return
    }

    // Register IPC handlers (await to catch load errors)
    await registerIpcHandlers()

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Clean up database on quit
  app.on('before-quit', () => {
    closeDatabaseService()
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
