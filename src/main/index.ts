import { app, dialog, shell, nativeImage, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3-multiple-ciphers'
import { registerIpcHandlers, destroyDbPool } from './ipc'
import { initDatabaseManager, initDatabaseManagerSafe, closeDatabaseManager } from './database'
import { mainLogger } from './services/MainLogger'
import { initAutoUpdater, scheduleUpdateChecks } from './services/AutoUpdater'
import { APP_CONFIG } from '../shared/config'
import { isUrlSafeForExternal } from './utils/url-validation'
import { markMilestone } from './services/MainPerfTrace'

if (process.env.VARLENS_APP_DATA_DIR !== undefined && process.env.VARLENS_APP_DATA_DIR !== '') {
  app.setPath('appData', process.env.VARLENS_APP_DATA_DIR)
}

if (process.env.VARLENS_USER_DATA_DIR !== undefined && process.env.VARLENS_USER_DATA_DIR !== '') {
  app.setPath('userData', process.env.VARLENS_USER_DATA_DIR)
}

// Disable GPU hardware acceleration when --disable-gpu flag is passed.
// This prevents blank/white windows on Windows systems with outdated or
// incompatible GPU drivers. Users can add this flag to the shortcut target.
if (app.commandLine.hasSwitch('disable-gpu')) {
  app.disableHardwareAcceleration()
}

// Prevent Chromium from permanently disabling WebGL after a GPU process crash.
// Without this, a single GPU glitch on Windows can break the 3D protein viewer
// for the rest of the session.
app.disableDomainBlockingFor3DAPIs()

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlSafeForExternal(url)) {
      setImmediate(() => shell.openExternal(url))
    }
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
    markMilestone('app-ready')

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.varlens.app')

    // Log startup context for cross-platform debugging
    mainLogger.info(
      `VarLens starting — platform=${process.platform}, arch=${process.arch}, ` +
        `electron=${process.versions.electron}, node=${process.versions.node}, ` +
        `userData=${app.getPath('userData')}`,
      'app'
    )
    mainLogger.info(`Log file: ${mainLogger.getLogFilePath()}`, 'app')

    // Log GPU feature status for diagnosing 3D viewer / WebGL issues on Windows
    try {
      const gpuStatus = app.getGPUFeatureStatus()
      mainLogger.info(
        `GPU features: webgl=${gpuStatus.webgl}, webgl2=${gpuStatus.webgl2}, ` +
          `gpu_compositing=${gpuStatus.gpu_compositing}`,
        'app'
      )
    } catch (e) {
      mainLogger.warn(
        'Failed to query GPU feature status: ' + (e instanceof Error ? e.message : String(e)),
        'app'
      )
    }

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

    // Initialize database manager with default database.
    // Wrapped in try/catch so a corrupted/locked default DB does not prevent
    // the window from opening — the user can still switch databases from the UI.
    try {
      await initDatabaseManager()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      mainLogger.error(`Failed to open default database: ${msg}`, 'database')
      // Create manager without opening a database so the app can still start.
      // The user will see "No database" and can pick/create one from the UI.
      initDatabaseManagerSafe()
    }

    // Register IPC handlers
    registerIpcHandlers()

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Suppress the "Insecure Content-Security-Policy" dev warning. This fires
    // because 'unsafe-eval' is required by Mol*/pdbe-molstar for WebGL shader
    // compilation. The warning does not appear in packaged builds.
    if (is.dev) {
      process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
    }

    // Create window after security handlers are registered
    createWindow()
    markMilestone('window-created')

    ipcMain.once('perf:interactive', () => {
      markMilestone('renderer-interactive')
    })

    // Deferred by 5s to avoid competing with startup data loading and rendering
    setTimeout(() => {
      initAutoUpdater()
      scheduleUpdateChecks()
    }, 5000)

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
    closeDatabaseManager().catch((e) => {
      mainLogger.warn(
        `DatabaseManager close failed during quit: ${e instanceof Error ? e.message : String(e)}`,
        'app'
      )
    })
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
