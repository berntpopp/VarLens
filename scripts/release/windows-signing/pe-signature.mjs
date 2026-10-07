// Minimal Portable Executable reader for the two questions the Windows
// release pipeline has to answer without a Windows host:
//
//   1. Does this file physically carry an Authenticode signature?
//   2. Is this file the same program as that one, apart from its signature?
//
// (1) is the cross-platform twin of `Get-AuthenticodeSignature ... -ne
// 'NotSigned'`: it checks that the PE certificate table is present and holds a
// PKCS#7 SignedData blob. It does NOT validate the chain — that stays with
// PowerShell on the runner. (2) is what lets the release prove that signing
// changed nothing but the signature: Authenticode leaves the image untouched
// except for the checksum field, the certificate-table directory entry and
// the certificate table appended at the end of the file (padded to 8 bytes).
// Hashing everything else gives a digest that is identical before and after
// signing and different for any other byte change.
import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

const HEADER_WINDOW = 4096
const PE32 = 0x10b
const PE32_PLUS = 0x20b
const SECURITY_DIRECTORY_INDEX = 4
// WIN_CERTIFICATE.wCertificateType for a PKCS#7 SignedData (Authenticode) blob.
const WIN_CERT_TYPE_PKCS_SIGNED_DATA = 0x0002
const CHUNK = 1 << 20

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length)
  const read = readSync(fd, buffer, 0, length, position)
  return buffer.subarray(0, read)
}

function parseHeader(fd, fileSize) {
  const head = readAt(fd, 0, Math.min(HEADER_WINDOW, fileSize))
  if (head.length < 64 || head.readUInt16LE(0) !== 0x5a4d) return null
  const peOffset = head.readUInt32LE(0x3c)
  const optionalOffset = peOffset + 24
  if (optionalOffset + 2 > head.length || head.readUInt32LE(peOffset) !== 0x00004550) return null
  const magic = head.readUInt16LE(optionalOffset)
  if (magic !== PE32 && magic !== PE32_PLUS) return null
  const directoriesOffset = optionalOffset + (magic === PE32 ? 96 : 112)
  const securityEntryOffset = directoriesOffset + SECURITY_DIRECTORY_INDEX * 8
  if (securityEntryOffset + 8 > head.length) return null
  const directoryCount = head.readUInt32LE(directoriesOffset - 4)
  const hasSecurityEntry = directoryCount > SECURITY_DIRECTORY_INDEX
  return {
    checksumOffset: optionalOffset + 64,
    securityEntryOffset,
    certTableOffset: hasSecurityEntry ? head.readUInt32LE(securityEntryOffset) : 0,
    certTableSize: hasSecurityEntry ? head.readUInt32LE(securityEntryOffset + 4) : 0
  }
}

function certificateTableIsSignedData(fd, fileSize, header) {
  const { certTableOffset, certTableSize } = header
  if (certTableOffset === 0 || certTableSize < 8) return false
  if (certTableOffset + certTableSize > fileSize) return false
  const entry = readAt(fd, certTableOffset, 8)
  if (entry.length < 8) return false
  const length = entry.readUInt32LE(0)
  const type = entry.readUInt16LE(6)
  return length > 8 && length <= certTableSize && type === WIN_CERT_TYPE_PKCS_SIGNED_DATA
}

/**
 * Describes a file's PE/Authenticode layout. `isPe` is false for anything that
 * is not a PE32/PE32+ image; the layout fields are then absent.
 */
export function inspectPe(path) {
  const fd = openSync(path, 'r')
  try {
    const fileSize = fstatSync(fd).size
    const header = parseHeader(fd, fileSize)
    if (!header) return { isPe: false, fileSize, signed: false }
    const signed = certificateTableIsSignedData(fd, fileSize, header)
    return { isPe: true, fileSize, signed, ...header }
  } finally {
    closeSync(fd)
  }
}

/** True only when the file is a PE image with an embedded PKCS#7 signature. */
export function hasAuthenticodeSignature(path) {
  const info = inspectPe(path)
  if (!info.isPe) throw new Error(`${path} is not a PE executable — cannot inspect its signature`)
  return info.signed
}

function hashRange(fd, hash, end, zeroRanges) {
  for (let position = 0; position < end; position += CHUNK) {
    const chunk = readAt(fd, position, Math.min(CHUNK, end - position))
    if (chunk.length === 0) throw new Error('unexpected end of file while hashing')
    for (const [from, length] of zeroRanges) {
      const lo = Math.max(from, position)
      const hi = Math.min(from + length, position + chunk.length)
      if (lo < hi) chunk.fill(0, lo - position, hi - position)
    }
    hash.update(chunk)
  }
}

/**
 * sha256 over the image with everything Authenticode is allowed to change
 * masked out: the checksum field and certificate-table directory entry are
 * zeroed, the certificate table is dropped, and the remainder is zero-padded
 * to the 8-byte boundary a signer aligns to. Equal digests mean "same program,
 * signature aside".
 */
export function signatureStrippedDigest(path) {
  const fd = openSync(path, 'r')
  try {
    const fileSize = fstatSync(fd).size
    const header = parseHeader(fd, fileSize)
    if (!header) throw new Error(`${path} is not a PE executable — cannot compute its image digest`)
    const signed = certificateTableIsSignedData(fd, fileSize, header)
    const end = signed ? header.certTableOffset : fileSize
    const hash = createHash('sha256')
    hashRange(fd, hash, end, [
      [header.checksumOffset, 4],
      [header.securityEntryOffset, 8]
    ])
    const padding = (8 - (end % 8)) % 8
    if (padding > 0) hash.update(Buffer.alloc(padding))
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}
