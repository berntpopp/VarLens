import { createReadStream, openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { createGunzip, gunzipSync } from 'node:zlib'
import { compose, Transform } from 'node:stream'
import type { Readable, TransformCallback } from 'node:stream'

/** Gzip magic number: first two bytes of any gzip file */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])

/**
 * Check if a file is gzip-compressed by reading its magic bytes.
 */
export function isGzipped(filePath: string): boolean {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(2)
    const bytesRead = readSync(fd, buf, 0, 2, 0)
    return bytesRead >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]
  } finally {
    closeSync(fd)
  }
}

/**
 * Create a readable stream that auto-detects gzip compression.
 * Returns a stream of decompressed (or raw) data ready for JSON parsing.
 */
export function createDecompressedStream(filePath: string): Readable {
  const raw = createReadStream(filePath)
  if (isGzipped(filePath)) {
    return raw.pipe(createGunzip())
  }
  return raw
}

// -----------------------------------------------------------------------------
// DoS caps for line-oriented VCF/BED consumers (full import, preview, header
// parsing, BED filtering). Two independent guards, layered because they
// defend against two different attack shapes:
//
//   1. MAX_LINE_BYTES — a single pathological line. `readline` (and any
//      full-file read) must buffer an entire line before anyone can inspect
//      it, so a byte-count guard applied *while streaming* is the only thing
//      that can stop a multi-GB single-line file from ever being held in
//      memory as one string/buffer.
//   2. MAX_DECOMPRESSED_BYTES — the total bytes produced by decompression
//      (or read from a plain file), which defeats a gzip "bomb" (a tiny
//      .vcf.gz/.bed.gz that inflates to many GB) regardless of how many
//      lines it contains.
//
// Rationale for the values chosen:
//   - MAX_LINE_BYTES (64 MiB): real-world heavily annotated VCF lines (many
//     ALT alleles x deep VEP CSQ / SnpEff ANN annotation, e.g. gnomAD-scale
//     multi-allelic sites) still land in the tens-of-KB to low-single-digit
//     MB range. 64 MiB leaves roughly 50-100x headroom over any legitimate
//     line while remaining three orders of magnitude below a "multi-GB
//     line" attack. This is the always-on guard — it is intentionally NOT
//     configurable, because a fixed byte ceiling is the only thing that
//     reliably stops a giant single line no matter how the total-byte
//     budget below is tuned for a given deployment.
//   - MAX_DECOMPRESSED_BYTES (256 GiB default): single-sample WGS VCFs
//     commonly decompress to 10-60 GB; joint-genotyped multi-sample cohort
//     VCFs can run substantially larger still. A single fixed cap cannot
//     both reject a bomb quickly *and* never reject a legitimate large
//     cohort file, so this cap is intentionally generous and overridable
//     via the VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES environment variable
//     (bytes) for sites importing genuinely larger joint-called cohorts.
//     It still bounds the worst case: a decompression bomb that would
//     otherwise inflate without limit is stopped once it crosses this
//     ceiling, rather than running until the process OOMs or hangs
//     indefinitely.
// -----------------------------------------------------------------------------

/** Always-on per-line byte cap — see rationale above. Not configurable. */
export const MAX_LINE_BYTES = 64 * 1024 * 1024 // 64 MiB

/** Default total decompressed-byte cap — see rationale above. */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024 * 1024 // 256 GiB

/** Environment variable that overrides DEFAULT_MAX_DECOMPRESSED_BYTES, in bytes. */
const MAX_DECOMPRESSED_BYTES_ENV_VAR = 'VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES'

/**
 * Resolve the effective total decompressed-byte cap: an explicit override
 * (used by tests / advanced call sites) wins, then the environment variable
 * override (for operators importing genuinely larger joint-called cohorts),
 * then the documented default.
 */
export function resolveMaxDecompressedBytes(override?: number): number {
  if (override !== undefined) return override
  const envValue = process.env[MAX_DECOMPRESSED_BYTES_ENV_VAR]
  if (envValue !== undefined) {
    const parsed = Number(envValue)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_MAX_DECOMPRESSED_BYTES
}

/** Thrown when a single line exceeds MAX_LINE_BYTES. */
export class LineTooLongError extends Error {
  constructor(maxLineBytes: number) {
    super(
      `Refusing to read a line longer than ${maxLineBytes} bytes (suspected malformed or hostile input)`
    )
    this.name = 'LineTooLongError'
  }
}

/** Thrown when total decompressed bytes exceed the configured cap. */
export class DecompressedSizeExceededError extends Error {
  constructor(maxBytes: number) {
    super(
      `Refusing to decompress more than ${maxBytes} bytes from a single file (suspected decompression bomb)`
    )
    this.name = 'DecompressedSizeExceededError'
  }
}

/**
 * Counts bytes flowing through and errors once `maxBytes` is exceeded.
 * Defeats a gzip bomb regardless of line structure.
 */
class ByteCapTransform extends Transform {
  private totalBytes = 0

  constructor(private readonly maxBytes: number) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.totalBytes += chunk.length
    if (this.totalBytes > this.maxBytes) {
      callback(new DecompressedSizeExceededError(this.maxBytes))
      return
    }
    callback(null, chunk)
  }
}

/**
 * Tracks bytes since the last `\n` seen and errors before a line exceeding
 * `maxLineBytes` is ever fully buffered by a downstream line reader (e.g.
 * `readline`). Passes all data through unmodified — this is a monitor, not a
 * transform of content.
 */
class LineLengthCapTransform extends Transform {
  private currentLineBytes = 0

  constructor(private readonly maxLineBytes: number) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    let searchStart = 0
    for (;;) {
      const newlineIndex = chunk.indexOf(0x0a, searchStart)
      if (newlineIndex === -1) {
        this.currentLineBytes += chunk.length - searchStart
        break
      }
      this.currentLineBytes += newlineIndex - searchStart + 1
      if (this.currentLineBytes > this.maxLineBytes) {
        callback(new LineTooLongError(this.maxLineBytes))
        return
      }
      this.currentLineBytes = 0
      searchStart = newlineIndex + 1
    }
    if (this.currentLineBytes > this.maxLineBytes) {
      callback(new LineTooLongError(this.maxLineBytes))
      return
    }
    callback(null, chunk)
  }
}

export interface CappedLineStreamOptions {
  /** Override MAX_LINE_BYTES. Production call sites should not set this. */
  maxLineBytes?: number
  /** Override the total decompressed-byte cap (tests, or advanced config). */
  maxDecompressedBytes?: number
}

/** Return value of {@link createCappedLineStream}. */
export interface CappedLineSource {
  /** Capped, gzip-aware stream — feed this into `readline.createInterface`. */
  stream: Readable
  /**
   * Bytes read so far from the underlying (possibly compressed) file on
   * disk. Exposed for callers that extrapolate progress from partial reads
   * (e.g. vcf-preview's line-count estimate) — not itself a DoS guard.
   */
  rawBytesRead: () => number
}

/**
 * Shared capped reader for VCF/BED line consumers. Auto-detects gzip,
 * decompresses if needed, and layers both DoS guards (per-line byte cap +
 * total decompressed-byte cap) on top, so any consumer that builds a
 * `readline` interface from the returned stream is automatically protected
 * against a giant single line and a decompression bomb without duplicating
 * the cap logic per consumer.
 *
 * On error, `stream.compose()` destroys every stage of the pipeline
 * (including the underlying file descriptor), so callers only need a single
 * 'error' listener on the returned stream.
 */
export function createCappedLineStream(
  filePath: string,
  options: CappedLineStreamOptions = {}
): CappedLineSource {
  const maxLineBytes = options.maxLineBytes ?? MAX_LINE_BYTES
  const maxDecompressedBytes = resolveMaxDecompressedBytes(options.maxDecompressedBytes)

  const raw = createReadStream(filePath)
  const gzipped = isGzipped(filePath)
  const byteCap = new ByteCapTransform(maxDecompressedBytes)
  const lineCap = new LineLengthCapTransform(maxLineBytes)

  const stream = gzipped
    ? compose(raw, createGunzip(), byteCap, lineCap)
    : compose(raw, byteCap, lineCap)

  return { stream, rawBytesRead: () => raw.bytesRead }
}

/**
 * Synchronously read an entire file (gzip-aware), bounded by
 * `maxDecompressedBytes`. Used by consumers whose algorithm needs the whole
 * file in memory at once (currently: `BedFilter`, whose interval-merging
 * pass is not naturally streaming). Never allocates a decompressed buffer
 * larger than the cap: gzip inputs are bounded via zlib's own
 * `maxOutputLength`, and plain-text inputs are size-checked via `stat`
 * before ever being read.
 */
export function readCappedFileSync(filePath: string, maxDecompressedBytes?: number): string {
  const maxBytes = resolveMaxDecompressedBytes(maxDecompressedBytes)
  const gzipped = isGzipped(filePath)

  if (!gzipped) {
    const { size } = statSync(filePath)
    if (size > maxBytes) {
      throw new DecompressedSizeExceededError(maxBytes)
    }
    return readFileSync(filePath, 'utf-8')
  }

  // Cheap pre-check: a compressed file already larger on disk than the cap
  // has no realistic path to a legitimate, sub-cap decompressed result --
  // reject before reading it fully into memory.
  const { size: compressedSize } = statSync(filePath)
  if (compressedSize > maxBytes) {
    throw new DecompressedSizeExceededError(maxBytes)
  }

  const compressed = readFileSync(filePath)
  try {
    return gunzipSync(compressed, { maxOutputLength: maxBytes }).toString('utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ERR_BUFFER_TOO_LARGE') {
      throw new DecompressedSizeExceededError(maxBytes)
    }
    throw error
  }
}
