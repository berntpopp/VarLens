import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

type Populate = (dest: string) => void

/**
 * Stands in for 7-Zip. Tests register, per archive path, a function that
 * writes that archive's contents into the extraction directory; `extract` has
 * the same signature as the real `sevenZipExtract`. Installers are also found
 * by file name, so a copy of one (the staged, published file) still opens.
 */
export function createArchiveStub() {
  const archives = new Map<string, Populate>()
  return {
    register(path: string, populate: Populate): void {
      archives.set(path, populate)
    },
    extract: (archive: string, dest: string): Promise<void> => {
      const populate = archives.get(archive) ?? archives.get(basename(archive))
      if (!populate) return Promise.reject(new Error(`stub: unknown archive ${archive}`))
      mkdirSync(dest, { recursive: true })
      populate(dest)
      return Promise.resolve()
    },
    /**
     * Registers `installerPath` as an NSIS installer: a container holding the
     * embedded app archive (a snapshot of `appDir` as it is right now) and,
     * optionally, the uninstaller it lays down.
     */
    registerInstaller(installerPath: string, appDir: string, uninstallerPath?: string): void {
      const frozenApp = `${installerPath}.payload`
      rmSync(frozenApp, { recursive: true, force: true })
      cpSync(appDir, frozenApp, { recursive: true })
      const frozenUninstaller = uninstallerPath ? `${installerPath}.uninstaller` : undefined
      if (uninstallerPath && frozenUninstaller) cpSync(uninstallerPath, frozenUninstaller)
      archives.set(basename(installerPath), (dest) => {
        mkdirSync(join(dest, '$PLUGINSDIR'), { recursive: true })
        const embedded = join(dest, '$PLUGINSDIR', 'app-64.7z')
        writeFileSync(embedded, 'embedded app archive')
        archives.set(embedded, (appDest) => cpSync(frozenApp, appDest, { recursive: true }))
        if (frozenUninstaller) {
          mkdirSync(join(dest, '$R0'), { recursive: true })
          cpSync(frozenUninstaller, join(dest, '$R0', 'Uninstall Varlens.exe'))
        }
      })
    }
  }
}
