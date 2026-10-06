/**
 * Transport-neutral port for host/runtime-specific operations (spec §4.1, Limin L2).
 *
 * Covers capabilities that differ between Electron and Web:
 * - Desktop: native file dialogs, path revelation, external URL opening.
 * - Web: browser-based file picking, downloads, URL opening.
 *
 * Concrete adapters:
 * - Electron: src/main/platform/electron-platform.ts
 * - Web: src/web/server/platform/web-platform.ts
 *
 * Scope note (PR-W10.0):
 * Core file/save/path/URL operations established here. Domain-specific extensions
 * (such as artifact delivery tokens for export and upload source streams for batch-import)
 * are added incrementally in their respective domain PRs (PR-W10.export, PR-W10.import).
 */

export interface PlatformFileFilter {
  name: string
  extensions: string[]
}

export interface PickFileOptions {
  title?: string
  filters?: PlatformFileFilter[]
  defaultPath?: string
  multiSelections?: boolean
}

export interface PickSaveLocationOptions {
  title?: string
  defaultPath?: string
  filters?: PlatformFileFilter[]
}

export interface PlatformPort {
  pickFile?: (options?: PickFileOptions) => Promise<string | string[] | null>
  pickSaveLocation?: (options?: PickSaveLocationOptions) => Promise<string | null>
  revealPath?: (targetPath: string) => Promise<void>
  openExternal?: (url: string) => Promise<void>
}
