import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  nodeConfigSource,
  parseWindowsRead
} from '../../../src/main/auth/desktop-auth-config-source'

describe.skipIf(process.platform === 'win32')('the real file system source', () => {
  it('reports a folder it may not look into as an error, not as absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-auth-probe-'))
    const closed = join(root, 'closed')
    mkdirSync(closed)
    chmodSync(closed, 0o000)
    try {
      const probe = nodeConfigSource().fs.probe(join(closed, 'auth.json'))
      // root ignores permissions; everyone else gets EACCES.
      if (process.getuid?.() !== 0) expect(probe).toEqual({ state: 'error', code: 'EACCES' })
      expect(nodeConfigSource().fs.probe(join(root, 'missing.json'))).toEqual({ state: 'absent' })
    } finally {
      chmodSync(closed, 0o700)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads no symbolic link and no oversized file', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-auth-read-'))
    try {
      const real = join(root, 'real.json')
      writeFileSync(real, '{}')
      symlinkSync(real, join(root, 'link.json'))
      writeFileSync(join(root, 'big.json'), 'x'.repeat(64 * 1024 + 1))
      const { readFile } = nodeConfigSource().fs
      expect(readFile(real)).toBe('{}')
      expect(() => readFile(join(root, 'link.json'))).toThrow()
      expect(() => readFile(join(root, 'big.json'))).toThrow(/larger than/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the Windows check result', () => {
  it('maps exit codes to reasons and decodes the content', () => {
    expect(() => parseWindowsRead({ status: 2, stdout: '' })).toThrow(/link or junction/)
    expect(() => parseWindowsRead({ status: 3, stdout: '' })).toThrow(/larger than/)
    expect(() => parseWindowsRead({ status: 4, stdout: '' })).toThrow(/folder/)
    expect(() => parseWindowsRead({ status: 1, stdout: '' })).toThrow(/check failed \(1\)/)
    expect(() => parseWindowsRead({ status: 0, stdout: '{}' })).toThrow(/no descriptor/)
    const content = Buffer.from('{"mode":"platform"}').toString('base64')
    expect(
      parseWindowsRead({
        status: 0,
        stdout: JSON.stringify({ file: 'O:BAD:', folder: 'O:SYD:', content })
      })
    ).toEqual({ fileSddl: 'O:BAD:', folderSddl: 'O:SYD:', content: '{"mode":"platform"}' })
  })
})
