/**
 * fs-durability.ts -- fsync helper tests.
 *
 * Covers the direct contract of `fsyncFile`/`fsyncContainingDirectory`:
 * fsyncing a real file/directory succeeds without throwing, a missing file
 * is a real (propagating) failure for `fsyncFile`, and a missing directory
 * is swallowed by `fsyncContainingDirectory`'s best-effort contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fsyncContainingDirectory, fsyncFile } from '../../../src/main/database/fs-durability'

describe('fs-durability', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-fs-durability-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('fsyncFile succeeds for an existing file', () => {
    const filePath = join(tmpDir, 'durable.txt')
    writeFileSync(filePath, 'hello', 'utf-8')

    expect(() => fsyncFile(filePath)).not.toThrow()
  })

  it('fsyncFile propagates a real failure for a missing file', () => {
    const filePath = join(tmpDir, 'does-not-exist.txt')

    expect(() => fsyncFile(filePath)).toThrow()
  })

  it('fsyncContainingDirectory succeeds (best-effort) for an existing directory', () => {
    const filePath = join(tmpDir, 'durable.txt')
    writeFileSync(filePath, 'hello', 'utf-8')

    expect(() => fsyncContainingDirectory(filePath)).not.toThrow()
  })

  it('fsyncContainingDirectory swallows a missing-directory failure rather than throwing', () => {
    const filePath = join(tmpDir, 'nested-missing-dir', 'durable.txt')

    expect(() => fsyncContainingDirectory(filePath)).not.toThrow()
  })
})
