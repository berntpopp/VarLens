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
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  // Electron 43 is the first release whose fuse wire exposes this fuse (the
  // wire grew from 8 to 9 entries), so `strictlyRequireAllFuses` now demands
  // an explicit value. Electron ships it enabled; the pristine 43.3.0 binary
  // reads back `1`. Kept at the shipped default: it selects hardware trap
  // handlers for WebAssembly bounds checks, which is a performance choice
  // rather than a security boundary, and disabling it would slow WASM without
  // hardening anything.
  [FuseV1Options.WasmTrapHandlers]: true
}

export default async function configureFuses(context) {
  await context.packager.addElectronFuses(context, FUSE_BASELINE)
}
