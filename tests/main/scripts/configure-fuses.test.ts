import { describe, it, expect } from 'vitest'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { FUSE_BASELINE } from '../../../scripts/configure-fuses.mjs'

describe('FUSE_BASELINE', () => {
  it('targets fuse wire version V1', () => {
    expect(FUSE_BASELINE.version).toBe(FuseVersion.V1)
  })

  it('enables strictlyRequireAllFuses so Electron upgrades fail loudly on new fuses', () => {
    expect(FUSE_BASELINE.strictlyRequireAllFuses).toBe(true)
  })

  it('declares every fuse exposed by the pinned @electron/fuses version', () => {
    const numericFuseKeys = Object.values(FuseV1Options).filter(
      (v): v is number => typeof v === 'number'
    )
    for (const fuseKey of numericFuseKeys) {
      expect(
        FUSE_BASELINE,
        `FUSE_BASELINE is missing a declaration for FuseV1Options=${FuseV1Options[fuseKey]} (${fuseKey})`
      ).toHaveProperty(String(fuseKey))
    }
  })

  it('enables OnlyLoadAppFromAsar', () => {
    expect(FUSE_BASELINE[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
  })

  it('keeps RunAsNode disabled', () => {
    expect(FUSE_BASELINE[FuseV1Options.RunAsNode]).toBe(false)
  })

  it('enables embedded ASAR integrity validation (pairs with OnlyLoadAppFromAsar)', () => {
    expect(FUSE_BASELINE[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
  })

  it('keeps EnableNodeOptionsEnvironmentVariable and EnableNodeCliInspectArguments disabled', () => {
    expect(FUSE_BASELINE[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    expect(FUSE_BASELINE[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
  })

  it('enables EnableCookieEncryption', () => {
    expect(FUSE_BASELINE[FuseV1Options.EnableCookieEncryption]).toBe(true)
  })

  it('requests resetAdHocDarwinSignature so ad-hoc-signed macOS builds get re-signed post-flip', () => {
    expect(FUSE_BASELINE.resetAdHocDarwinSignature).toBe(true)
  })
})
