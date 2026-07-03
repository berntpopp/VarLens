import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { parseOptions } from '../../../src/web/provision-user'

const base = ['--username', 'u', '--display-name', 'd']

describe('provision-user parseOptions', () => {
  test('B4b: rejects inline --password (leaks via process listing / shell history)', () => {
    expect(() => parseOptions([...base, '--password', 'hunter2'])).toThrow(/inline --password/i)
  })

  test('accepts --password-hash (inline hash is not a plaintext secret)', () => {
    const opts = parseOptions([...base, '--password-hash', 'argon2hash'])
    expect(opts.credential).toEqual({ kind: 'hash', value: 'argon2hash' })
  })

  test('accepts --password-file (secret read from a file, not argv)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'provision-user-'))
    const file = join(dir, 'pw.txt')
    writeFileSync(file, 'secret\n')
    const opts = parseOptions([...base, '--password-file', file])
    expect(opts.credential).toEqual({ kind: 'password', value: 'secret' })
  })
})
