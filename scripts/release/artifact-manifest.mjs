// Single source of truth for the asset set a release must contain.
//
// Derived from package.json's build.{linux,mac,win} target + artifactName
// templates, and cross-checked (see Task 2 Step 2 of the cross-workflow
// dedupe plan) against the actually published v0.70.4 release assets —
// 10 names across the three platforms. Both the promotion verifier
// (verify-promoted-artifacts.mjs) and the workflow that generates the
// build matrix consume `expectedArtifacts` and `PLATFORMS` directly, so
// keep both names stable.
export const PLATFORMS = Object.freeze(['linux', 'mac', 'win'])

const PRODUCT = 'Varlens'

// package.json's build.mac target pins arch to arm64 for both dmg and zip.
const MAC_ARCH = 'arm64'

export function expectedArtifacts(platform, version) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`unknown platform "${platform}" (expected one of ${PLATFORMS.join(', ')})`)
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('version must be a non-empty string')
  }

  switch (platform) {
    case 'linux':
      return [`${PRODUCT}-${version}.AppImage`, `${PRODUCT}-${version}.deb`, 'latest-linux.yml']
    case 'mac':
      return [
        `${PRODUCT}-${version}-${MAC_ARCH}.dmg`,
        `${PRODUCT}-${version}-${MAC_ARCH}.zip`,
        'latest-mac.yml'
      ]
    case 'win':
      // win.artifactName is "${productName}-Setup-${version}.${ext}", which
      // the zip target also picks up; only the `portable` target overrides it.
      return [
        `${PRODUCT}-Setup-${version}.exe`,
        `${PRODUCT}-Portable-${version}.exe`,
        `${PRODUCT}-Setup-${version}.zip`,
        'latest.yml'
      ]
    default:
      // Unreachable: the PLATFORMS.includes() guard above already rejected
      // anything not in PLATFORMS. Kept so an exhaustive switch reads as
      // exhaustive rather than silently falling through to `undefined`.
      throw new Error(`unhandled platform "${platform}"`)
  }
}
