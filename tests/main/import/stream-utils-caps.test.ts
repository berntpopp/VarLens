/**
 * Tests for the shared DoS caps in stream-utils.ts:
 *  - MAX_LINE_BYTES / LineTooLongError (per-line byte cap)
 *  - MAX_DECOMPRESSED_BYTES / DecompressedSizeExceededError (total decompressed-byte cap)
 *
 * These caps are the shared implementation routed through all four VCF/BED
 * line consumers (VcfStrategy import, vcf-preview, vcf-header-parser,
 * bed-filter). Per-consumer routing/rejection is covered in each consumer's
 * own test file; this file proves the shared primitives themselves.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createInterface } from 'node:readline'
import {
  createCappedLineStream,
  LineTooLongError,
  DecompressedSizeExceededError,
  DecompressionRatioExceededError
} from '../../../src/main/import/stream-utils'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'varlens-stream-caps-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** Collect lines from a capped stream via readline, resolving with lines or rejecting with the stream's error. */
function collectLines(
  filePath: string,
  opts?: {
    maxLineBytes?: number
    maxDecompressedBytes?: number
    maxCompressionRatio?: number
    minCompressionRatioBytes?: number
  }
) {
  return new Promise<string[]>((resolve, reject) => {
    const { stream } = createCappedLineStream(filePath, opts)
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    const lines: string[] = []
    let settled = false

    rl.on('line', (line) => lines.push(line))
    rl.on('close', () => {
      if (settled) return
      settled = true
      resolve(lines)
    })
    rl.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    stream.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

describe('createCappedLineStream', () => {
  it('rejects a line exceeding the per-line byte cap with LineTooLongError', async () => {
    const filePath = join(tmpDir, 'giant-line.vcf')
    const giantLine = 'A'.repeat(200) // over the 100-byte test cap below
    writeFileSync(filePath, `short line\n${giantLine}\nafter\n`)

    await expect(collectLines(filePath, { maxLineBytes: 100 })).rejects.toThrow(LineTooLongError)
  })

  it('rejects a decompressed plain stream exceeding the total-byte cap with DecompressedSizeExceededError', async () => {
    const filePath = join(tmpDir, 'big-plain.vcf')
    writeFileSync(filePath, 'line1\n'.repeat(1000)) // 6000 bytes total

    await expect(collectLines(filePath, { maxDecompressedBytes: 100 })).rejects.toThrow(
      DecompressedSizeExceededError
    )
  })

  it('rejects a gzip stream whose decompressed size exceeds the total-byte cap (simulated bomb)', async () => {
    const filePath = join(tmpDir, 'bomb.vcf.gz')
    // Highly compressible content: a tiny gzip payload that inflates far
    // past a small test cap -- stands in for a real decompression bomb.
    const inflated = 'A'.repeat(1_000_000) + '\n'
    writeFileSync(filePath, gzipSync(Buffer.from(inflated)))

    await expect(
      collectLines(filePath, { maxDecompressedBytes: 1000, maxLineBytes: 2_000_000 })
    ).rejects.toThrow(DecompressedSizeExceededError)
  })

  it('rejects a gzip bomb by expansion ratio before the total-byte cap', async () => {
    const filePath = join(tmpDir, 'ratio-bomb.vcf.gz')
    writeFileSync(filePath, gzipSync(Buffer.from('A'.repeat(100_000) + '\n')))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 1_000_000,
        maxLineBytes: 200_000,
        maxCompressionRatio: 5,
        minCompressionRatioBytes: 1_000
      })
    ).rejects.toThrow(DecompressionRatioExceededError)
  })

  it('applies the production expansion ratio when only the check floor is overridden', async () => {
    const filePath = join(tmpDir, 'default-ratio-bomb.vcf.gz')
    writeFileSync(filePath, gzipSync(Buffer.from('A'.repeat(2_000_000) + '\n')))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 3_000_000,
        maxLineBytes: 3_000_000,
        minCompressionRatioBytes: 1_000
      })
    ).rejects.toThrow(DecompressionRatioExceededError)
  })

  it('measures consumed gzip bytes so trailing padding cannot defeat the ratio guard', async () => {
    const filePath = join(tmpDir, 'padded-ratio-bomb.vcf.gz')
    const compressed = gzipSync(Buffer.from('A'.repeat(2_000_000) + '\n'))
    writeFileSync(filePath, Buffer.concat([compressed, Buffer.alloc(1_000_000)]))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 3_000_000,
        maxLineBytes: 3_000_000,
        maxCompressionRatio: 50,
        minCompressionRatioBytes: 1_000
      })
    ).rejects.toThrow(DecompressionRatioExceededError)
  })

  it('accepts a gzip below the configured expansion ratio', async () => {
    const filePath = join(tmpDir, 'normal-ratio.vcf.gz')
    const content = Array.from({ length: 500 }, (_, index) => `chr1\t${index}\t${index ** 2}`).join(
      '\n'
    )
    writeFileSync(filePath, gzipSync(Buffer.from(content)))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 1_000_000,
        maxCompressionRatio: 20,
        minCompressionRatioBytes: 100
      })
    ).resolves.toHaveLength(500)
  })

  it('does not apply the ratio guard below its output floor', async () => {
    const filePath = join(tmpDir, 'small-compressible.vcf.gz')
    writeFileSync(filePath, gzipSync(Buffer.from('A'.repeat(5_000) + '\n')))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 10_000,
        maxLineBytes: 10_000,
        maxCompressionRatio: 1,
        minCompressionRatioBytes: 8_000
      })
    ).resolves.toEqual(['A'.repeat(5_000)])
  })

  it('reads a legitimate small file without false rejection (default caps)', async () => {
    const filePath = join(tmpDir, 'legit.vcf')
    writeFileSync(filePath, '##fileformat=VCFv4.2\n#CHROM\tPOS\nchr1\t100\n')

    const lines = await collectLines(filePath)
    expect(lines).toEqual(['##fileformat=VCFv4.2', '#CHROM\tPOS', 'chr1\t100'])
  })

  it('reads a legitimate gzipped file without false rejection (default caps)', async () => {
    const filePath = join(tmpDir, 'legit.vcf.gz')
    writeFileSync(filePath, gzipSync(Buffer.from('##fileformat=VCFv4.2\nchr1\t100\n')))

    const lines = await collectLines(filePath)
    expect(lines).toEqual(['##fileformat=VCFv4.2', 'chr1\t100'])
  })
})
