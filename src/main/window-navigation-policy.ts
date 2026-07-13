import { fileURLToPath } from 'node:url'

/**
 * Decide whether the main frame is allowed to navigate to `url` (fired from
 * the `will-navigate` webContents event).
 *
 * A compromised or malicious renderer script can trigger top-frame
 * navigation (e.g. `window.location = ...`, a same-tab link). If we let that
 * navigation through, the main frame keeps its preload/`window.api` bridge,
 * so navigating to an arbitrary page would hand it privileged IPC access.
 * The policy therefore only allows two destinations:
 *
 *  - the dev renderer origin (`ELECTRON_RENDERER_URL`), compared by WHATWG
 *    origin (not `startsWith`, which `http://localhost:5173.evil.com` would
 *    satisfy against `http://localhost:5173`);
 *  - the packaged app document (`appDocUrl`), compared by exact `file:`
 *    path — not merely `startsWith('file://')`, which would allow
 *    navigation to any local file.
 */
export function isMainWindowNavigationAllowed(
  url: string,
  rendererUrl: string | undefined,
  appDocUrl: string
): boolean {
  try {
    const target = new URL(url)

    if (rendererUrl !== undefined && rendererUrl !== '') {
      const dev = new URL(rendererUrl)
      if (target.origin === dev.origin) return true
    }

    const doc = new URL(appDocUrl)
    return (
      target.protocol === 'file:' &&
      doc.protocol === 'file:' &&
      target.host === doc.host &&
      target.search === '' &&
      fileURLToPath(target) === fileURLToPath(doc)
    )
  } catch {
    return false
  }
}
