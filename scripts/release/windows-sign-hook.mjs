// electron-builder Windows signing hook (`build.win.signtoolOptions.sign` in
// package.json). electron-builder calls it once per file it would otherwise
// hand to signtool.exe: the app executable, the NSIS elevate helper, the
// uninstaller, and each installer (app-builder-lib winPackager.signApp,
// nsisUtil.CopyElevateHelper, NsisTarget.computeScriptAndSignUninstaller /
// buildInstaller).
//
// The hook is inert unless VARLENS_WINDOWS_SIGNING selects a backend, so
// every ordinary package run — local `make dist-win`, build.yml — produces
// exactly the unsigned output it always did. Signing happens only in the
// release re-wrap (scripts/release/rewrap-windows.mjs), which sets the mode.
import process from 'node:process'

import { signFile } from './windows-signing/sign-file.mjs'
import { resolveSigningMode } from './windows-signing/signing-backends.mjs'
import { classifySigningRequest } from './windows-signing/signing-plan.mjs'

export async function sign(configuration, _packager, { env = process.env, deps } = {}) {
  const mode = resolveSigningMode(env)
  if (mode === 'off') return

  // `signingHashAlgorithms: ["sha256"]` makes electron-builder call the hook
  // once per file. A sha1 or nested (dual-signing) request means that setting
  // was lost, which would silently double the signature cost of a release.
  if (configuration.hash !== 'sha256' || configuration.isNest) {
    throw new Error(
      `unexpected ${configuration.hash}${configuration.isNest ? ' nested' : ''} signing request — ` +
        'build.win.signtoolOptions.signingHashAlgorithms must stay ["sha256"]'
    )
  }
  const version = (env.VARLENS_WINDOWS_SIGN_VERSION ?? '').trim()
  if (!version) throw new Error('signing is enabled but VARLENS_WINDOWS_SIGN_VERSION is not set')

  const role = classifySigningRequest(configuration.path, version)
  await signFile({ file: configuration.path, role, mode, env, deps })
}

export default sign
