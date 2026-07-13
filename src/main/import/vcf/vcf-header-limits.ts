export const DEFAULT_MAX_VCF_HEADER_BYTES = 16 * 1024 * 1024
export const DEFAULT_MAX_VCF_HEADER_LINES = 100_000

const MAX_HEADER_BYTES_ENV = 'VARLENS_VCF_MAX_HEADER_BYTES'
const MAX_HEADER_LINES_ENV = 'VARLENS_VCF_MAX_HEADER_LINES'

function resolvePositiveLimit(
  value: number | undefined,
  envName: string,
  fallback: number
): number {
  if (value !== undefined) return value
  const parsed = Number(process.env[envName])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export interface VcfHeaderLimitOptions {
  maxHeaderBytes?: number
  maxHeaderLines?: number
}

export class VcfHeaderLimitExceededError extends Error {
  constructor(kind: 'bytes' | 'lines', maximum: number) {
    super(`Refusing to parse a VCF header exceeding ${maximum} ${kind}`)
    this.name = 'VcfHeaderLimitExceededError'
  }
}

/** Independent budget for accumulated VCF metadata, separate from file/line caps. */
export class VcfHeaderBudget {
  private bytes = 0
  private lines = 0
  private readonly maxBytes: number
  private readonly maxLines: number

  constructor(options: VcfHeaderLimitOptions = {}) {
    this.maxBytes = resolvePositiveLimit(
      options.maxHeaderBytes,
      MAX_HEADER_BYTES_ENV,
      DEFAULT_MAX_VCF_HEADER_BYTES
    )
    this.maxLines = resolvePositiveLimit(
      options.maxHeaderLines,
      MAX_HEADER_LINES_ENV,
      DEFAULT_MAX_VCF_HEADER_LINES
    )
  }

  add(line: string): void {
    this.lines += 1
    if (this.lines > this.maxLines) {
      throw new VcfHeaderLimitExceededError('lines', this.maxLines)
    }

    this.bytes += Buffer.byteLength(line, 'utf8') + 1
    if (this.bytes > this.maxBytes) {
      throw new VcfHeaderLimitExceededError('bytes', this.maxBytes)
    }
  }
}
