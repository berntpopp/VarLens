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
import { createWriteStream, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGzip, gzipSync } from 'node:zlib'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import {
  createCappedLineStream,
  LineTooLongError,
  DecompressedSizeExceededError,
  DecompressionRatioExceededError,
  MAX_GZIP_COMPRESSION_RATIO,
  MIN_GZIP_RATIO_CHECK_BYTES
} from '../../../src/main/import/stream-utils'
import {
  GzipRatioPolicy,
  MAX_GZIP_FORMAT_INSPECTION_BYTES
} from '../../../src/main/import/gzip-ratio-policy'

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

/** Count a large capped stream without retaining every decompressed line. */
function countLines(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const { stream } = createCappedLineStream(filePath)
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let count = 0
    let settled = false
    rl.on('line', () => {
      count += 1
    })
    rl.on('close', () => {
      if (settled) return
      settled = true
      resolve(count)
    })
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    rl.on('error', rejectOnce)
    stream.on('error', rejectOnce)
  })
}

async function writeHighSampleVcfGzip(
  filePath: string
): Promise<{ decompressedBytes: number; expectedLines: number }> {
  const sampleCount = 500
  const rowCount = 35_000
  const gzip = createGzip()
  const output = createWriteStream(filePath)
  gzip.pipe(output)

  const fileformat = '##fileformat=VCFv4.2\n'
  const header = `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${Array.from(
    { length: sampleCount },
    (_, index) => `S${index}`
  ).join('\t')}\n`
  gzip.write(fileformat)
  gzip.write(header)
  let decompressedBytes = Buffer.byteLength(fileformat) + Buffer.byteLength(header)
  const genotypes = Array.from({ length: sampleCount }, () => '0/0').join('\t')
  for (let position = 1; position <= rowCount; position += 1) {
    const row = `1\t${position}\t.\tA\tG\t30\tPASS\t.\tGT\t${genotypes}\n`
    decompressedBytes += Buffer.byteLength(row)
    if (!gzip.write(row)) {
      await once(gzip, 'drain')
    }
  }
  gzip.end()
  await once(output, 'close')
  return { decompressedBytes, expectedLines: rowCount + 2 }
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

  it('rejects a gzip bomb made of many individually short lines', async () => {
    const filePath = join(tmpDir, 'short-line-ratio-bomb.vcf.gz')
    writeFileSync(filePath, gzipSync(Buffer.from('A\n'.repeat(1_000_000))))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 3_000_000,
        minCompressionRatioBytes: 1_000
      })
    ).rejects.toThrow(DecompressionRatioExceededError)
  })

  it('does not grant the VCF allowance to header-shaped input with malformed data rows', async () => {
    const filePath = join(tmpDir, 'spoofed-cohort.vcf.gz')
    const samples = Array.from({ length: 1_000 }, (_, index) => `S${index}`).join('\t')
    const content = `##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${samples}\n${'A\n'.repeat(1_000_000)}`
    writeFileSync(filePath, gzipSync(Buffer.from(content)))

    await expect(
      collectLines(filePath, {
        maxDecompressedBytes: 3_000_000,
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

  it('accepts a valid high-sample VCF above the production ratio-check floor', async () => {
    const filePath = join(tmpDir, 'joint-cohort.vcf.gz')
    const { decompressedBytes, expectedLines } = await writeHighSampleVcfGzip(filePath)

    expect(decompressedBytes).toBeGreaterThan(MIN_GZIP_RATIO_CHECK_BYTES)
    expect(decompressedBytes / statSync(filePath).size).toBeGreaterThan(MAX_GZIP_COMPRESSION_RATIO)

    await expect(countLines(filePath)).resolves.toBe(expectedLines)
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

describe('GzipRatioPolicy', () => {
  it('uses absolute byte/line/header budgets after structural VCF validation', () => {
    const samples = Array.from({ length: 2_000 }, (_, index) => `S${index}`).join('\t')
    const genotypes = Array.from({ length: 2_000 }, () => '0/0').join('\t')
    const policy = new GzipRatioPolicy(MAX_GZIP_COMPRESSION_RATIO)
    policy.observe(
      Buffer.from(
        `##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${samples}\n1\t1\t.\tA\tG\t30\tPASS\t.\tGT\t${genotypes}\n`
      )
    )
    expect(policy.maxRatio()).toBe(Number.POSITIVE_INFINITY)
  })

  it('stops inspecting a minified non-VCF prefix within a fixed byte budget', () => {
    const policy = new GzipRatioPolicy(MAX_GZIP_COMPRESSION_RATIO)
    const minifiedJson = Buffer.alloc(MAX_GZIP_FORMAT_INSPECTION_BYTES * 256, 0x61)
    minifiedJson.write('{"variants":[')
    const startedAt = performance.now()

    policy.observe(minifiedJson)

    expect(performance.now() - startedAt).toBeLessThan(100)
    expect(MAX_GZIP_FORMAT_INSPECTION_BYTES).toBeLessThan(minifiedJson.length)
    expect(policy.maxRatio()).toBe(MAX_GZIP_COMPRESSION_RATIO)
  })
})
