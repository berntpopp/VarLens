import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

import { expectedArtifacts } from '../../scripts/release/artifact-manifest.mjs'
import {
  publishedWindowsArtifacts,
  transportArchiveName
} from '../../scripts/release/windows-signing/signing-plan.mjs'

const ROOT = resolve(__dirname, '..', '..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')
const release = read('.github/workflows/release.yml')
const rehearsal = read('.github/workflows/windows-signing-rehearsal.yml')

/** The `sign-windows` job, split into its steps (each starting at `- name:`). */
function signJobSteps(): string[] {
  const job = release.slice(
    release.indexOf('  sign-windows:'),
    release.indexOf('  publish-release:')
  )
  return job.split(/\n {6}- name: /).slice(1)
}
const step = (name: string): string => {
  const found = signJobSteps().find((text) => text.startsWith(name))
  if (!found) throw new Error(`release.yml sign-windows has no step "${name}"`)
  return found
}

describe('package.json Windows signing configuration', () => {
  const win = (
    JSON.parse(read('package.json')) as {
      build: { win: { target: string[]; signtoolOptions: Record<string, unknown> } }
    }
  ).build.win

  test('routes every electron-builder signing request through the repo hook', () => {
    expect(win.signtoolOptions.sign).toBe('scripts/release/windows-sign-hook.mjs')
  })

  test('signs with sha256 only, so each file costs one signature, not two', () => {
    expect(win.signtoolOptions.signingHashAlgorithms).toEqual(['sha256'])
  })

  test('keeps the zip target, which carries the unpacked app directory to the release', () => {
    expect(win.target).toContain('zip')
    expect(expectedArtifacts('win', '9.9.9')).toContain(transportArchiveName('9.9.9'))
  })
})

describe('release.yml Windows signing job', () => {
  test('keeps every signing step behind the ESIGNER_ENABLED kill switch', () => {
    for (const name of [
      'Install packaging dependencies',
      'Create a throwaway certificate for the signing rehearsal',
      'Rehearse signing and re-wrap (no quota)',
      'Rehearse the Authenticode assertion',
      'Setup Java for CodeSignTool',
      'Download and configure CodeSignTool',
      'Sign every Windows executable and re-wrap the installers',
      'Assert an Authenticode signature on every shipped executable'
    ]) {
      expect(step(name), name).toContain("if: vars.ESIGNER_ENABLED == 'true'")
    }
    expect(step('Stage unsigned installers')).toContain("if: vars.ESIGNER_ENABLED != 'true'")
  })

  test('hands eSigner credentials to exactly one step, through the environment', () => {
    const withSecrets = signJobSteps().filter((text) => /secrets\.ES_/.test(text))
    expect(withSecrets).toHaveLength(1)
    const paid = withSecrets[0]
    expect(paid.startsWith('Sign every Windows executable and re-wrap the installers')).toBe(true)
    expect(paid).toContain('VARLENS_WINDOWS_SIGNING: esigner')
    for (const name of ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
      expect(paid).toContain(`${name}: \${{ secrets.${name} }}`)
    }
    // Never interpolated into script text, where a log or a quoting slip could expose them.
    const script = paid.slice(paid.indexOf('run: |'))
    expect(script).not.toContain('secrets.')
    expect(script).toContain('node scripts/release/rewrap-windows.mjs')
  })

  test('rehearses the whole pipeline for free before the paid signing step', () => {
    const names = signJobSteps().map((text) => text.split('\n')[0])
    const rehearse = names.indexOf('Rehearse signing and re-wrap (no quota)')
    const paid = names.indexOf('Sign every Windows executable and re-wrap the installers')
    expect(rehearse).toBeGreaterThan(-1)
    expect(paid).toBeGreaterThan(rehearse)
    expect(step('Rehearse signing and re-wrap (no quota)')).toContain(
      'VARLENS_WINDOWS_SIGNING: selfsigned'
    )
    // Rehearsal output stays in RUNNER_TEMP; only the paid step writes publish/win.
    expect(step('Rehearse signing and re-wrap (no quota)')).not.toContain('publish/win')
  })

  test('installs dependencies without lifecycle scripts in the job that holds the credentials', () => {
    expect(step('Install packaging dependencies')).toContain('npm ci --ignore-scripts')
    expect(release.slice(release.indexOf('  sign-windows:'))).not.toMatch(/npm ci\s*$/m)
  })

  test('verifies promoted bytes before signing and the shipped bytes after it', () => {
    const names = signJobSteps().map((text) => text.split('\n')[0])
    const order = [
      'Verify promoted artifacts',
      'Sign every Windows executable and re-wrap the installers',
      'Verify auto-update metadata matches the shipped binaries',
      'Inspect every executable in every Windows artifact',
      'Assert an Authenticode signature on every shipped executable',
      'Upload artifacts'
    ].map((name) => names.indexOf(name))
    expect(order.every((index) => index > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('checks latest.yml and every inner executable unconditionally, on what is uploaded', () => {
    const latest = step('Verify auto-update metadata matches the shipped binaries')
    expect(latest).not.toMatch(/^\s*if: /m)
    expect(latest).toContain('verify-latest-yml.mjs publish/win/latest.yml publish/win')
    const inspect = step('Inspect every executable in every Windows artifact')
    expect(inspect).not.toMatch(/^\s*if: /m)
    expect(inspect).toContain("REQUIRE_SIGNED: ${{ vars.ESIGNER_ENABLED == 'true' }}")
    expect(inspect).toContain('--require-signed')
    expect(inspect).toContain('--dir publish/win')
  })

  test('uploads exactly the published set — the transport zip is not a release asset', () => {
    const upload = step('Upload artifacts')
    expect(upload).toContain('publish/win/*.exe')
    expect(upload).toContain('publish/win/latest.yml')
    expect(upload).not.toContain('.zip')
    expect(upload).not.toContain('promoted/')
    expect(publishedWindowsArtifacts('9.9.9')).not.toContain(transportArchiveName('9.9.9'))
  })

  test('uses the Windows-native check that rejects NotSigned and rehearsal signatures', () => {
    const script = read('scripts/release/assert-authenticode.ps1')
    expect(script).toContain('Get-AuthenticodeSignature -LiteralPath $row.absolute')
    expect(script).toContain("$signature.Status -eq 'NotSigned'")
    expect(script).toContain("-not $Rehearsal -and $subject -match 'signing rehearsal'")
    expect(step('Assert an Authenticode signature on every shipped executable')).not.toContain(
      '-Rehearsal'
    )
  })
})

describe('windows-signing-rehearsal.yml', () => {
  test('is manual only, holds no secrets beyond the workflow token and cannot publish', () => {
    expect(rehearsal).toMatch(/^on:\n {2}workflow_dispatch:/m)
    expect(rehearsal).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/)
    expect(rehearsal).not.toContain('contents: write')
    expect(rehearsal).not.toContain('gh release')
    expect(rehearsal).not.toContain('upload-artifact')
    expect(rehearsal).not.toContain('esigner')
  })

  test('runs the same scripts as the release, with the self-signed backend', () => {
    expect(rehearsal).toContain('VARLENS_WINDOWS_SIGNING: selfsigned')
    for (const script of [
      'verify-promoted-artifacts.mjs',
      'rewrap-windows.mjs',
      'verify-latest-yml.mjs',
      'verify-windows-signatures.mjs',
      'assert-authenticode.ps1'
    ]) {
      expect(rehearsal, script).toContain(`scripts/release/${script}`)
      expect(release, script).toContain(`scripts/release/${script}`)
    }
  })
})
