import { readFileSync } from 'fs'
import { gunzipSync } from 'zlib'

interface Interval {
  start: number // 1-based inclusive
  end: number // 1-based inclusive
}

/**
 * BED region filter with O(log n) overlap check per query.
 * BED format is 0-based half-open; internally stored as 1-based inclusive.
 */
export class BedFilter {
  private intervals: Map<string, Interval[]>
  private _isEmpty: boolean

  private constructor(intervals: Map<string, Interval[]>, isEmpty: boolean) {
    this.intervals = intervals
    this._isEmpty = isEmpty
  }

  /** Create an empty filter that passes everything through */
  static empty(): BedFilter {
    return new BedFilter(new Map(), true)
  }

  /** Load intervals from a .bed or .bed.gz file with optional padding */
  static fromFile(filePath: string, padding: number): BedFilter {
    const raw = filePath.endsWith('.gz')
      ? gunzipSync(readFileSync(filePath)).toString('utf-8')
      : readFileSync(filePath, 'utf-8')

    const intervals = new Map<string, Interval[]>()

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('track') ||
        trimmed.startsWith('browser')
      ) {
        continue
      }
      const parts = trimmed.split('\t')
      if (parts.length < 3) continue

      const chr = parts[0]
      // BED is 0-based half-open -> convert to 1-based inclusive, then apply padding
      const start = Math.max(1, parseInt(parts[1], 10) + 1 - padding)
      const end = parseInt(parts[2], 10) + padding

      if (!intervals.has(chr)) {
        intervals.set(chr, [])
      }
      intervals.get(chr)!.push({ start, end })
    }

    // Sort and merge overlapping intervals per chromosome
    for (const [chr, ivs] of intervals) {
      ivs.sort((a, b) => a.start - b.start || a.end - b.end)
      const merged: Interval[] = []
      for (const iv of ivs) {
        if (merged.length > 0 && iv.start <= merged[merged.length - 1].end + 1) {
          merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end)
        } else {
          merged.push({ ...iv })
        }
      }
      intervals.set(chr, merged)
    }

    return new BedFilter(intervals, false)
  }

  /** Total number of intervals loaded */
  intervalCount(): number {
    let count = 0
    for (const ivs of this.intervals.values()) {
      count += ivs.length
    }
    return count
  }

  /** Check if a 1-based position falls within any interval on this chromosome */
  contains(chr: string, pos: number): boolean {
    if (this._isEmpty) return true
    const ivs = this.intervals.get(chr)
    if (!ivs || ivs.length === 0) return false
    return this.binarySearchContains(ivs, pos)
  }

  /** Check if a range [start, end] (1-based inclusive) overlaps any interval */
  containsRange(chr: string, start: number, end: number): boolean {
    if (this._isEmpty) return true
    const ivs = this.intervals.get(chr)
    if (!ivs || ivs.length === 0) return false
    return this.binarySearchOverlaps(ivs, start, end)
  }

  private binarySearchContains(ivs: Interval[], pos: number): boolean {
    let lo = 0
    let hi = ivs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (pos < ivs[mid].start) {
        hi = mid - 1
      } else if (pos > ivs[mid].end) {
        lo = mid + 1
      } else {
        return true
      }
    }
    return false
  }

  private binarySearchOverlaps(ivs: Interval[], start: number, end: number): boolean {
    let lo = 0
    let hi = ivs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (ivs[mid].end < start) {
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (lo < ivs.length && ivs[lo].start <= end) {
      return true
    }
    return false
  }
}
