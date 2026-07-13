/** Default gzip expansion ratio for JSON, BED, and small-sample VCF input. */
export const DEFAULT_MAX_GZIP_COMPRESSION_RATIO = 100

/**
 * Hard upper bound for sample-aware VCF expansion. Large joint-called VCFs
 * contain thousands of repeated genotype columns and legitimately compress
 * far beyond the generic 100x ceiling. A 1000x ceiling accepts those files
 * while still requiring one compressed byte per 1000 output bytes before the
 * independent absolute decompressed-byte cap is reached.
 */
export const MAX_VCF_GZIP_COMPRESSION_RATIO = 1000

/**
 * Incrementally identifies a VCF and counts samples from its #CHROM header.
 * It retains only short line prefixes and tab counts, never a full header or
 * data line, so the policy itself cannot become a new buffering sink.
 */
export class GzipRatioPolicy {
  private atLineStart = true
  private linePrefix = ''
  private lineTabs = 0
  private firstLine = true
  private vcf = false
  private sampleCount = 0
  private inspectionComplete = false

  constructor(private readonly baseRatio: number) {}

  observe(chunk: Buffer): void {
    if (this.inspectionComplete) return

    for (const byte of chunk) {
      if (this.atLineStart) {
        this.atLineStart = false
        this.linePrefix = ''
        this.lineTabs = 0
      }
      if (this.linePrefix.length < 24 && byte !== 0x0a && byte !== 0x0d) {
        this.linePrefix += String.fromCharCode(byte)
      }
      if (byte === 0x09) this.lineTabs += 1
      if (byte !== 0x0a) continue

      if (this.firstLine) {
        this.vcf = this.linePrefix.startsWith('##fileformat=VCFv')
        this.firstLine = false
        this.inspectionComplete = !this.vcf
      } else if (this.vcf && this.linePrefix.startsWith('#CHROM\t')) {
        // Nine fixed/FORMAT columns produce eight tabs before sample columns.
        this.sampleCount = Math.max(0, this.lineTabs - 8)
        this.inspectionComplete = true
      }
      if (this.inspectionComplete) return
      this.atLineStart = true
    }
  }

  maxRatio(): number {
    if (!this.vcf) return this.baseRatio
    return Math.min(MAX_VCF_GZIP_COMPRESSION_RATIO, this.baseRatio + this.sampleCount)
  }
}
