/** Default gzip expansion ratio for JSON, BED, and small-sample VCF input. */
export const DEFAULT_MAX_GZIP_COMPRESSION_RATIO = 100

export const MAX_GZIP_FORMAT_INSPECTION_BYTES = 4096

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
  private vcfHeaderTabs: number | null = null
  private vcfDataShapeValidated = false
  private inspectionComplete = false
  private firstLineBytes = 0
  private fixedFieldMask = 0
  private posDigitsOnly = true
  private posHasNonZeroDigit = false

  constructor(private readonly baseRatio: number) {}

  observe(chunk: Buffer): void {
    if (this.inspectionComplete) return

    for (const byte of chunk) {
      if (this.atLineStart) {
        this.atLineStart = false
        this.linePrefix = ''
        this.lineTabs = 0
        this.fixedFieldMask = 0
        this.posDigitsOnly = true
        this.posHasNonZeroDigit = false
      }
      if (this.firstLine) {
        this.firstLineBytes += 1
        if (this.firstLineBytes > MAX_GZIP_FORMAT_INSPECTION_BYTES) {
          this.inspectionComplete = true
          return
        }
      }
      if (this.linePrefix.length < 24 && byte !== 0x0a && byte !== 0x0d) {
        this.linePrefix += String.fromCharCode(byte)
      }
      if (byte === 0x09) {
        this.lineTabs += 1
      } else if (byte !== 0x0a && byte !== 0x0d) {
        if (this.lineTabs < 8) this.fixedFieldMask |= 1 << this.lineTabs
        if (this.lineTabs === 1) {
          this.posDigitsOnly &&= byte >= 0x30 && byte <= 0x39
          this.posHasNonZeroDigit ||= byte >= 0x31 && byte <= 0x39
        }
      }
      if (byte !== 0x0a) continue

      if (this.firstLine) {
        this.vcf = this.linePrefix.startsWith('##fileformat=VCFv')
        this.firstLine = false
        this.inspectionComplete = !this.vcf
      } else if (this.vcfHeaderTabs === null) {
        this.observeVcfHeaderLine()
      } else {
        this.observeVcfDataLine()
      }
      if (this.inspectionComplete) return
      this.atLineStart = true
    }
  }

  maxRatio(): number {
    if (!this.vcf || !this.vcfDataShapeValidated) return this.baseRatio
    // Compression ratio cannot distinguish a valid, highly repetitive cohort
    // VCF from a bomb. Once the magic/header/first-row shape is established,
    // the independent absolute decompressed-byte, line, header, record and
    // expansion-work budgets own resource control without false rejection.
    return Number.POSITIVE_INFINITY
  }

  private observeVcfHeaderLine(): void {
    if (!this.linePrefix.startsWith('#CHROM\t')) return
    // Eight mandatory site columns produce seven tabs. FORMAT is the ninth
    // column, so each tab beyond eight represents one declared sample.
    if (this.lineTabs < 7) {
      this.revokeVcfAllowance()
      return
    }
    this.vcfHeaderTabs = this.lineTabs
  }

  private observeVcfDataLine(): void {
    if (
      this.linePrefix === '' ||
      this.linePrefix.startsWith('#') ||
      this.lineTabs !== this.vcfHeaderTabs ||
      (this.fixedFieldMask & 0b0001_1011) !== 0b0001_1011 ||
      !this.posDigitsOnly ||
      !this.posHasNonZeroDigit
    ) {
      this.revokeVcfAllowance()
      return
    }
    this.vcfDataShapeValidated = true
  }

  private revokeVcfAllowance(): void {
    this.vcfDataShapeValidated = false
    this.inspectionComplete = true
  }
}
