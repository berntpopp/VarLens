import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveNativeTarget } from '../../scripts/native/rebuild-native.mjs'

describe('native install runtime selection', () => {
  it('keeps ordinary desktop installs on Electron', () => {
    expect(resolveNativeTarget('install', {})).toBe('electron')
  })

  it('selects the Node ABI before Node-only install work', () => {
    expect(resolveNativeTarget('install', { VARLENS_NATIVE_RUNTIME: 'node' })).toBe('node')
  })

  it('honors explicit rebuild commands independently of install defaults', () => {
    expect(resolveNativeTarget('electron', { VARLENS_NATIVE_RUNTIME: 'node' })).toBe('electron')
    expect(resolveNativeTarget('node', { VARLENS_NATIVE_RUNTIME: 'electron' })).toBe('node')
  })

  it.each(['deno', '', 'node; echo unsafe'])(
    'rejects an invalid install runtime: %s',
    (runtime) => {
      expect(() => resolveNativeTarget('install', { VARLENS_NATIVE_RUNTIME: runtime })).toThrow(
        /VARLENS_NATIVE_RUNTIME/
      )
    }
  )

  it('fails the CLI before rebuilding when install configuration is invalid', () => {
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/native/rebuild-native.mjs'), 'install'],
      {
        env: { ...process.env, VARLENS_NATIVE_RUNTIME: 'invalid' },
        encoding: 'utf8'
      }
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('VARLENS_NATIVE_RUNTIME')
    expect(result.stdout).not.toContain('compiling')
  })
})
