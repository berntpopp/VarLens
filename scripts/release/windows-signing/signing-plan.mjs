// The signing plan: the single place that says which Windows executables a
// release signs, and therefore how many eSigner signatures a release costs.
//
// Every signature is drawn from a 20/month quota, so the plan is an allowlist
// rather than a pattern: a file the plan does not name is never signed, and an
// executable the plan does not account for fails the run before any signature
// is spent. Changing what ships (a new helper .exe, a new installer target)
// means changing this file and the count in
// .planning/specs/2026-10-06-windows-sign-all-executables.md together.
import { readdirSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

const PRODUCT = 'Varlens'

/** Executables electron-builder's pack step leaves in the unpacked app dir. */
export const APP_EXECUTABLES = Object.freeze([`${PRODUCT}.exe`])

/** Copied into the app dir, and signed, by electron-builder's NSIS target. */
export const ELEVATE_HELPER = 'resources/elevate.exe'

/** Name the NSIS installer gives the uninstaller it lays down. */
export const INSTALLED_UNINSTALLER = `Uninstall ${PRODUCT}.exe`

export const ROLES = Object.freeze(['app', 'elevate', 'uninstaller', 'installer', 'portable'])

/** One signature per role per release. This is the number the quota is planned against. */
export const EXPECTED_SIGNATURE_COUNT = ROLES.length

export function installerName(version) {
  return `${PRODUCT}-Setup-${version}.exe`
}

export function portableName(version) {
  return `${PRODUCT}-Portable-${version}.exe`
}

/** The build.yml zip target: the checksummed image of the fused, unpacked app dir. */
export function transportArchiveName(version) {
  return `${PRODUCT}-Setup-${version}.zip`
}

/** What a Windows release publishes. The transport zip is deliberately not in it. */
export function publishedWindowsArtifacts(version) {
  return [installerName(version), portableName(version), 'latest.yml']
}

function toPosix(path) {
  return path.split(sep).join('/')
}

/** Every `*.exe` under `dir`, as sorted posix paths relative to it. */
export function listExecutables(dir) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        found.push(toPosix(relative(dir, full)))
      }
    }
  }
  walk(dir)
  return found.sort()
}

/**
 * Decides which executables of the unpacked app dir get signed before the
 * installers are wrapped around it. Throws — before anything is signed — when
 * the directory holds an executable the plan does not account for, or lacks
 * one it expects: either means the signature count is no longer the planned one.
 */
export function planAppSigning(appDir) {
  const present = listExecutables(appDir).filter((path) => path !== ELEVATE_HELPER)
  const unexpected = present.filter((path) => !APP_EXECUTABLES.includes(path))
  if (unexpected.length > 0) {
    throw new Error(
      `unplanned executable(s) in the app directory: ${unexpected.join(', ')} — ` +
        'add them to the signing plan (and the per-release signature count) before releasing'
    )
  }
  const missing = APP_EXECUTABLES.filter((path) => !present.includes(path))
  if (missing.length > 0) {
    throw new Error(`expected executable(s) missing from the app directory: ${missing.join(', ')}`)
  }
  return APP_EXECUTABLES.map((path) => join(appDir, path))
}

/**
 * Maps a file electron-builder asks the signing hook to sign onto a plan role.
 * Anything else is refused: an unrecognised request would otherwise spend an
 * unplanned signature.
 */
export function classifySigningRequest(filePath, version) {
  const normalized = filePath.replaceAll('\\', '/')
  const name = basename(normalized)
  if (normalized.endsWith(`/${ELEVATE_HELPER}`)) return 'elevate'
  if (name === installerName(version)) return 'installer'
  if (name === portableName(version)) return 'portable'
  // NsisTarget writes the intermediate uninstaller next to the installer as
  // `<installer basename>__uninstaller.exe` (NsisTarget.js, computeScriptAndSignUninstaller).
  if (name.endsWith('__uninstaller.exe')) return 'uninstaller'
  if (APP_EXECUTABLES.includes(name)) return 'app'
  throw new Error(
    `refusing to sign ${name}: it is not in the Windows signing plan ` +
      '(scripts/release/windows-signing/signing-plan.mjs)'
  )
}
