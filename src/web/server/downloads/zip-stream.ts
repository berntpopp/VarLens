/**
 * Minimal streaming ZIP writer (deflate, data descriptors, no ZIP64).
 *
 * Each entry's content is an async iterable that is deflated and emitted as
 * it is produced; CRC-32 and sizes go into a trailing data descriptor
 * (general-purpose flag bit 3), so nothing is buffered beyond zlib's window
 * and the caller's current chunk. Memory stays bounded however large the
 * export is. Used for streamed XLSX (an XLSX file is a ZIP of XML parts).
 *
 * Limits (no ZIP64): fewer than 65 535 entries and every size below 4 GiB;
 * exceeding either throws instead of writing a corrupt archive.
 */
import { once } from 'node:events'
import { constants as zlibConstants, crc32, createDeflateRaw } from 'node:zlib'

export interface ZipEntrySource {
  name: string
  content: () => AsyncIterable<Buffer | string>
}

const UINT32_LIMIT = 0xffffffff
const MAX_ENTRIES = 0xffff
const FLAG_DATA_DESCRIPTOR = 0x0008
const FLAG_UTF8_NAME = 0x0800
const METHOD_DEFLATE = 8
const VERSION = 20

interface CentralRecord {
  name: Buffer
  crc: number
  compressedSize: number
  size: number
  offset: number
}

function dosDateTime(date: Date): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

function localHeader(name: Buffer, stamp: { time: number; day: number }): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(VERSION, 4)
  header.writeUInt16LE(FLAG_DATA_DESCRIPTOR | FLAG_UTF8_NAME, 6)
  header.writeUInt16LE(METHOD_DEFLATE, 8)
  header.writeUInt16LE(stamp.time, 10)
  header.writeUInt16LE(stamp.day, 12)
  // CRC and sizes are 0 here; the data descriptor carries them.
  header.writeUInt16LE(name.length, 26)
  return Buffer.concat([header, name])
}

function dataDescriptor(record: CentralRecord): Buffer {
  const descriptor = Buffer.alloc(16)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(record.crc >>> 0, 4)
  descriptor.writeUInt32LE(record.compressedSize, 8)
  descriptor.writeUInt32LE(record.size, 12)
  return descriptor
}

function centralHeader(record: CentralRecord, stamp: { time: number; day: number }): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(VERSION, 4)
  header.writeUInt16LE(VERSION, 6)
  header.writeUInt16LE(FLAG_DATA_DESCRIPTOR | FLAG_UTF8_NAME, 8)
  header.writeUInt16LE(METHOD_DEFLATE, 10)
  header.writeUInt16LE(stamp.time, 12)
  header.writeUInt16LE(stamp.day, 14)
  header.writeUInt32LE(record.crc >>> 0, 16)
  header.writeUInt32LE(record.compressedSize, 20)
  header.writeUInt32LE(record.size, 24)
  header.writeUInt16LE(record.name.length, 28)
  header.writeUInt32LE(record.offset, 42)
  return Buffer.concat([header, record.name])
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return end
}

function assertZip32(value: number, what: string): void {
  if (value > UINT32_LIMIT) throw new Error(`ZIP ${what} exceeds 4 GiB (ZIP64 is not supported)`)
}

/** Deflate one entry, yielding compressed chunks; fills `record` as it goes. */
async function* deflateEntry(
  source: AsyncIterable<Buffer | string>,
  record: CentralRecord
): AsyncGenerator<Buffer> {
  const deflate = createDeflateRaw({ level: zlibConstants.Z_DEFAULT_COMPRESSION })
  // Aborted when the consumer stops early (client disconnect): unblocks a
  // pump waiting for 'drain' and stops it pulling more source content, which
  // returns the source iterator (and with it the database row stream).
  const abort = new AbortController()
  const pump = (async () => {
    try {
      for await (const part of source) {
        if (abort.signal.aborted) break
        const chunk = typeof part === 'string' ? Buffer.from(part, 'utf8') : part
        if (chunk.length === 0) continue
        record.crc = crc32(chunk, record.crc)
        record.size += chunk.length
        assertZip32(record.size, 'entry')
        if (!deflate.write(chunk)) await once(deflate, 'drain', { signal: abort.signal })
      }
      if (!abort.signal.aborted) deflate.end()
    } catch (error) {
      if (!abort.signal.aborted) deflate.destroy(error as Error)
    }
  })()
  try {
    for await (const out of deflate as AsyncIterable<Buffer>) {
      record.compressedSize += out.length
      yield out
    }
  } finally {
    abort.abort()
    if (!deflate.destroyed) deflate.destroy()
    await pump
  }
}

/**
 * Stream a ZIP archive of `entries`, in order. The iterator is lazy: entry
 * content is not pulled until the consumer reads that far, so backpressure
 * from the HTTP socket reaches the row source.
 */
export async function* zipStream(
  entries: Iterable<ZipEntrySource>,
  now: Date = new Date()
): AsyncGenerator<Buffer> {
  const stamp = dosDateTime(now)
  const records: CentralRecord[] = []
  let offset = 0

  for (const entry of entries) {
    if (records.length >= MAX_ENTRIES) throw new Error('ZIP has too many entries')
    const record: CentralRecord = {
      name: Buffer.from(entry.name, 'utf8'),
      crc: 0,
      compressedSize: 0,
      size: 0,
      offset
    }
    const header = localHeader(record.name, stamp)
    offset += header.length
    yield header
    for await (const chunk of deflateEntry(entry.content(), record)) {
      offset += chunk.length
      yield chunk
    }
    assertZip32(record.compressedSize, 'entry')
    const descriptor = dataDescriptor(record)
    offset += descriptor.length
    assertZip32(offset, 'archive')
    yield descriptor
    records.push(record)
  }

  const centralStart = offset
  let centralSize = 0
  for (const record of records) {
    const header = centralHeader(record, stamp)
    centralSize += header.length
    yield header
  }
  assertZip32(centralStart + centralSize, 'archive')
  yield endOfCentralDirectory(records.length, centralSize, centralStart)
}
