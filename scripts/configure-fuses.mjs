// Electron fuse baseline for packaged VarLens builds.
// Invoked by electron-builder via `build.afterPack` in package.json.
// Owns the flip via `addElectronFuses(...)`; the declarative
// `build.electronFuses` block in package.json is intentionally absent so
// electron-builder's internal `doAddElectronFuses` short-circuits.
//
// `strictlyRequireAllFuses: true` forces this file to declare every fuse
// known to the pinned @electron/fuses version. A future Electron upgrade
// that introduces a new fuse will make builds fail here until the baseline
// declares an explicit value for it.

import { FuseVersion, FuseV1Options } from '@electron/fuses'

export const FUSE_BASELINE = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  resetAdHocDarwinSignature: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
}

export default async function configureFuses(context) {
  await context.packager.addElectronFuses(context, FUSE_BASELINE)
}
