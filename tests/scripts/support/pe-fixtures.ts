import { readFileSync, writeFileSync } from 'fs'

// Smallest PE32+ image the release tooling will accept: a DOS header pointing
// at a PE header whose optional header declares all 16 data directories. No
// sections — nothing here is ever executed, only parsed.
const PE_OFFSET = 0x80
const OPTIONAL_OFFSET = PE_OFFSET + 24
const CHECKSUM_OFFSET = OPTIONAL_OFFSET + 64
const DIRECTORIES_OFFSET = OPTIONAL_OFFSET + 112
const SECURITY_ENTRY_OFFSET = DIRECTORIES_OFFSET + 4 * 8
const HEADER_SIZE = 512

/** An unsigned PE image whose "code" is `body`. */
export function makePe(body: string): Buffer {
  const header = Buffer.alloc(HEADER_SIZE)
  header.write('MZ', 0, 'latin1')
  header.writeUInt32LE(PE_OFFSET, 0x3c)
  header.write('PE\0\0', PE_OFFSET, 'latin1')
  header.writeUInt16LE(0x20b, OPTIONAL_OFFSET)
  header.writeUInt32LE(16, DIRECTORIES_OFFSET - 4)
  return Buffer.concat([header, Buffer.from(body)])
}

/**
 * Does to a PE file what an Authenticode signer does, minus the cryptography:
 * pads the image to 8 bytes, appends a WIN_CERTIFICATE (PKCS#7 SignedData
 * type) table, points the security directory at it and rewrites the checksum.
 * This is the stubbed signer the pipeline tests drive.
 */
export function fakeSign(path: string, signer = 'test-signer'): void {
  const image = readFileSync(path)
  const padded = Buffer.concat([image, Buffer.alloc((8 - (image.length % 8)) % 8)])
  const blob = Buffer.from(`pkcs7:${signer}`)
  const length = 8 + blob.length
  const certificate = Buffer.alloc(Math.ceil(length / 8) * 8)
  certificate.writeUInt32LE(length, 0)
  certificate.writeUInt16LE(0x0200, 4)
  certificate.writeUInt16LE(0x0002, 6)
  blob.copy(certificate, 8)
  padded.writeUInt32LE(padded.length, SECURITY_ENTRY_OFFSET)
  padded.writeUInt32LE(certificate.length, SECURITY_ENTRY_OFFSET + 4)
  padded.writeUInt32LE(0xdeadbeef, CHECKSUM_OFFSET)
  writeFileSync(path, Buffer.concat([padded, certificate]))
}
