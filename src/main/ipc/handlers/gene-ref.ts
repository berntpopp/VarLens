import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { getGeneReferenceDb, closeGeneReferenceDb } from '../../database/geneReferenceLoader'
import { mainLogger } from '../../services/MainLogger'
import { execFile } from 'child_process'
import { resolve, join } from 'path'
import { app } from 'electron'
import { existsSync, copyFileSync } from 'fs'

/**
 * Gene Reference database IPC handlers
 */
export function registerGeneRefHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('gene-ref:info', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      const info = geneRef.getInfo()
      const scriptPath = resolve(app.getAppPath(), 'scripts', 'build-gene-reference-db.ts')
      const canUpdate = !app.isPackaged && existsSync(scriptPath)
      return {
        ...info,
        canUpdate
      }
    })
  })

  ipcMain.handle('gene-ref:assemblies', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      return geneRef.getAssemblies()
    })
  })

  /**
   * Check if the gene reference DB needs updating.
   * Returns age info and whether it's older than 90 days.
   */
  ipcMain.handle('gene-ref:check-updates', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      const info = geneRef.getInfo()
      const nowMs = Date.now()
      const builtAtMs = info.builtAt * 1000 // builtAt is Unix seconds
      const daysSinceBuilt = Math.floor((nowMs - builtAtMs) / (1000 * 60 * 60 * 24))
      const scriptPath = resolve(app.getAppPath(), 'scripts', 'build-gene-reference-db.ts')
      const canUpdate = !app.isPackaged && existsSync(scriptPath)
      const needsUpdate = canUpdate && daysSinceBuilt > 90

      return {
        currentBuiltAt: info.builtAt,
        daysSinceBuilt,
        needsUpdate,
        canUpdate
      }
    })
  })

  /**
   * Update the gene reference DB by running the build script.
   * Uses child_process to execute the build script, then copies the result
   * to userData path and reloads the DB singleton.
   *
   * In production builds the build script is not available, so returns a
   * descriptive error message.
   */
  ipcMain.handle('gene-ref:update', async () => {
    return wrapHandler(async () => {
      // Resolve the build script path
      const appPath = app.getAppPath()
      const scriptPath = resolve(appPath, 'scripts', 'build-gene-reference-db.ts')

      if (app.isPackaged || !existsSync(scriptPath)) {
        mainLogger.warn(
          `Gene ref build script not available (packaged=${app.isPackaged}, path=${scriptPath})`,
          'gene-ref'
        )
        return {
          success: false,
          message:
            'Gene reference update is not available in the packaged app. A future update will include this feature.'
        }
      }

      // Use npx to resolve tsx portably (handles .cmd on Windows, PATH resolution)
      const isWin = process.platform === 'win32'
      const npxCmd = isWin ? 'npx.cmd' : 'npx'

      // Destination: always write to userData so it takes precedence on next load
      const userDataDbPath = join(app.getPath('userData'), 'gene_reference.db')
      // The build script writes to resources/gene_reference.db by default
      const buildOutputPath = resolve(appPath, 'resources', 'gene_reference.db')

      mainLogger.info('Starting gene reference DB update...', 'gene-ref')

      return new Promise<{ success: boolean; message: string }>((resolve_p) => {
        execFile(
          npxCmd,
          ['tsx', scriptPath],
          {
            cwd: appPath,
            timeout: 5 * 60 * 1000, // 5 minute timeout
            shell: isWin,
            env: { ...process.env }
          },
          (error, stdout, stderr) => {
            if (error) {
              const errMsg = stderr || error.message
              mainLogger.error(`Gene ref update failed: ${errMsg}`, 'gene-ref')
              resolve_p({
                success: false,
                message: `Update failed: ${errMsg}`
              })
              return
            }

            mainLogger.info(`Gene ref build output: ${stdout}`, 'gene-ref')

            // Copy the rebuilt DB to userData so it takes precedence over the bundled version
            try {
              copyFileSync(buildOutputPath, userDataDbPath)
              mainLogger.info(`Gene ref DB copied to userData: ${userDataDbPath}`, 'gene-ref')
            } catch (copyError) {
              mainLogger.error(
                `Failed to copy gene ref DB to userData: ${copyError instanceof Error ? copyError.message : String(copyError)}`,
                'gene-ref'
              )
              resolve_p({
                success: false,
                message: `Build succeeded but failed to copy to user data directory: ${copyError instanceof Error ? copyError.message : String(copyError)}`
              })
              return
            }

            // Reload the DB singleton (will now pick up userData copy first)
            try {
              closeGeneReferenceDb()
              const geneRef = getGeneReferenceDb()
              const info = geneRef.getInfo()
              mainLogger.info(`Gene reference DB reloaded: ${info.geneCount} genes`, 'gene-ref')
              resolve_p({
                success: true,
                message: `Updated successfully. ${info.geneCount.toLocaleString()} genes loaded.`
              })
            } catch (reloadError) {
              mainLogger.error(
                `Gene ref reload failed: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
                'gene-ref'
              )
              resolve_p({
                success: false,
                message: `Build succeeded but reload failed: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`
              })
            }
          }
        )
      })
    })
  })
}
