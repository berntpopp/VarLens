import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { comparePayload, snapshotTree } from '../../scripts/release/windows-signing/payload.mjs'
import {
  hasAuthenticodeSignature,
  inspectPe,
  signatureStrippedDigest
} from '../../scripts/release/windows-signing/pe-signature.mjs'
import { fakeSign, makePe } from './support/pe-fixtures'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-pe-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writePe(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, makePe(body))
  return path
}

describe('hasAuthenticodeSignature', () => {
  it('reports an unsigned PE image as unsigned', () => {
    expect(hasAuthenticodeSignature(writePe('app.exe', 'code'))).toBe(false)
  })

  it('reports a PE image with a PKCS#7 certificate table as signed', () => {
    const path = writePe('app.exe', 'code')
    fakeSign(path)
    expect(hasAuthenticodeSignature(path)).toBe(true)
  })

  it('does not accept a security directory that points past the end of the file', () => {
    const path = writePe('app.exe', 'code')
    fakeSign(path)
    writeFileSync(path, readFileSync(path).subarray(0, 520))
    expect(hasAuthenticodeSignature(path)).toBe(false)
  })

  it('does not accept a certificate table that is not PKCS#7 SignedData', () => {
    const path = writePe('app.exe', 'code')
    fakeSign(path)
    const bytes = readFileSync(path)
    const tableOffset = inspectPe(path).certTableOffset as number
    bytes.writeUInt16LE(0x0001, tableOffset + 6)
    writeFileSync(path, bytes)
    expect(hasAuthenticodeSignature(path)).toBe(false)
  })

  it('throws for a file that is not a PE image rather than calling it unsigned', () => {
    const path = join(dir, 'notes.exe')
    writeFileSync(path, 'just text')
    expect(() => hasAuthenticodeSignature(path)).toThrow(/not a PE executable/)
  })
})

describe('signatureStrippedDigest', () => {
  it('is unchanged by signing', () => {
    // Odd body length: the signer has to pad to 8 bytes before the table.
    const path = writePe('app.exe', 'seven..')
    const before = signatureStrippedDigest(path)
    fakeSign(path)
    expect(signatureStrippedDigest(path)).toBe(before)
  })

  it('is the same whoever signed the image', () => {
    const one = writePe('one.exe', 'code')
    const two = writePe('two.exe', 'code')
    fakeSign(one, 'rehearsal')
    fakeSign(two, 'a-much-longer-production-signer-identity')
    expect(signatureStrippedDigest(one)).toBe(signatureStrippedDigest(two))
  })

  it('changes when a single byte of the image changes', () => {
    const path = writePe('app.exe', 'code')
    const before = signatureStrippedDigest(path)
    const bytes = readFileSync(path)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(path, bytes)
    expect(signatureStrippedDigest(path)).not.toBe(before)
  })
})

describe('comparePayload', () => {
  function writeTree(root: string): void {
    writeFileSync(join(root, 'Varlens.exe'), makePe('app'))
    writeFileSync(join(root, 'app.asar'), 'asar-bytes')
  }

  it('treats a signed executable as the same payload', async () => {
    writeTree(dir)
    const reference = await snapshotTree(dir)
    fakeSign(join(dir, 'Varlens.exe'))
    expect(await comparePayload(reference, dir)).toEqual([])
  })

  it('reports changed, missing and unexpected files', async () => {
    writeTree(dir)
    const reference = await snapshotTree(dir)
    writeFileSync(join(dir, 'app.asar'), 'tampered')
    rmSync(join(dir, 'Varlens.exe'))
    writeFileSync(join(dir, 'planted.dll'), 'x')
    expect((await comparePayload(reference, dir)).sort()).toEqual([
      'changed: app.asar',
      'missing: Varlens.exe',
      'unexpected: planted.dll'
    ])
  })

  it('reports an executable whose code changed even if it is signed afterwards', async () => {
    writeTree(dir)
    const reference = await snapshotTree(dir)
    writeFileSync(join(dir, 'Varlens.exe'), makePe('different app'))
    fakeSign(join(dir, 'Varlens.exe'))
    expect(await comparePayload(reference, dir)).toEqual(['changed: Varlens.exe'])
  })

  it('allows only the named extra files', async () => {
    writeTree(dir)
    const reference = await snapshotTree(dir)
    writeFileSync(join(dir, 'elevate.exe'), makePe('elevate'))
    expect(await comparePayload(reference, dir, { allowedExtra: ['elevate.exe'] })).toEqual([])
    expect(await comparePayload(reference, dir)).toEqual(['unexpected: elevate.exe'])
  })
})
