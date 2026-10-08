import type { FileImportRequest } from '../../../shared/types/import-worker'
import { BedFilter } from './bed-filter'
import type { VcfRawRecord, VcfMappedVariant } from './types'

/** Variant type discriminator */
export type VariantType = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/**
 * Import-time filters applied during VCF streaming.
 *
 * ## Per-variant-type behavior
 *
 * | Filter      | SNV / indel | SV (Sniffles, Manta)        | CNV (Spectre, etc.)     | STR (Straglr)      |
 * |-------------|-------------|-----------------------------|-------------------------|--------------------|
 * | `passOnly`  | ✅ applies  | ✅ applies                  | ✅ applies              | ✅ applies         |
 * | `minQual`   | ✅ applies  | ⚠ no-op when QUAL=`.`       | ⚠ no-op when QUAL=`.`  | ⚠ no-op when QUAL=`.` |
 * | `bedFilter` | ✅ point    | ✅ range overlap (uses END) | ✅ range overlap        | ✅ range overlap   |
 * | `minGq`     | ✅ applies  | ✅ when FORMAT/GQ is set    | ✅ when FORMAT/GQ is set | ⚠ no-op (no GQ)   |
 * | `minDp`     | ✅ applies  | ⚠ no-op (no FORMAT/DP)      | ⚠ no-op                | ⚠ no-op            |
 *
 * The filters apply to every file of an import, the first included, on both
 * backends (`tests/main/workers/vcf-import-filters-backend-parity.e2e.test.ts`).
 *
 * **Semantic notes:**
 *
 * 1. **`passOnly`**: a record is kept if its FILTER column equals `PASS` or is
 *    `.` (missing/unknown). Multi-filter records like `LowQual;HighStrand`
 *    are rejected. Whitespace is trimmed before comparison.
 *
 * 2. **`minQual` on SVs**: SV callers frequently leave QUAL as `.` and score
 *    variants via caller-specific metrics (Sniffles: SUPPORT/VAF; Manta:
 *    PR/SR). Records with missing QUAL pass the filter unchanged so that a
 *    `minQual=20` setting doesn't accidentally drop an entire SV callset.
 *    The per-caller quality metrics are NOT filtered at import time — use
 *    the case-view column filters instead.
 *
 * 3. **`bedFilter`**: range overlap is preferred when the INFO field carries
 *    a numeric END (set by Sniffles, Spectre, Straglr, Manta, etc.). For
 *    breakend notation (`ALT=N]chr2:1234]`) and point-like records without
 *    END, a single-position contains check on `POS` is used. Only the
 *    primary breakend is checked; mate-pair records are tested independently
 *    on their own POS.
 *
 * 4. **`minGq` / `minDp`**: these gate the sample's FORMAT/GQ and FORMAT/DP
 *    fields, whatever the variant type. A record without the field passes
 *    unchanged, so a callset that does not write it (Straglr, for example)
 *    is never dropped for the missing metric. A caller that does write it
 *    (Sniffles2 and Spectre write GQ) is filtered by it.
 */
export interface ImportFilters {
  bedFilter?: BedFilter
  bedPadding: number
  passOnly: boolean
  minQual: number | null
  minGq: number | null
  minDp: number | null
}

/** Default import filters — no filtering */
export const DEFAULT_IMPORT_FILTERS: ImportFilters = {
  bedPadding: 50,
  passOnly: false,
  minQual: null,
  minGq: null,
  minDp: null
}

/**
 * Check whether a raw VCF record passes the pre-mapping gate (FILTER, QUAL,
 * BED region).
 *
 * Returns `true` if the record should be kept, `false` if it should be
 * skipped. Safe to call with `filters === undefined` — returns true.
 *
 * Exported for reuse between the worker import path (`VcfStrategy.ts`)
 * and the main-thread append path (`import-logic-append.ts`). Keeping the
 * two paths in sync through a single helper avoids semantic drift.
 */
export function passesPreMappingFilters(
  record: VcfRawRecord,
  filters: ImportFilters | undefined
): boolean {
  if (filters === undefined) return true

  // ── FILTER column gate ────────────────────────────────────────────
  // VCF spec: FILTER is either `PASS`, `.` (missing), or a semicolon-
  // separated list of failed filter IDs. We accept PASS and missing.
  if (filters.passOnly) {
    const f = record.filter.trim()
    if (f !== 'PASS' && f !== '.' && f !== '') return false
  }

  // ── QUAL threshold ────────────────────────────────────────────────
  // Missing QUAL (`.` → null) is NOT treated as a failing score.
  // Rationale: SV/CNV/STR callers routinely leave QUAL empty and scoring
  // happens via caller-specific INFO/FORMAT fields. Treating missing as
  // a failure would silently wipe entire SV callsets.
  if (filters.minQual !== null && record.qual !== null && record.qual < filters.minQual) {
    return false
  }

  // ── BED region gate ───────────────────────────────────────────────
  // Prefer range overlap when INFO/END is set (SV, CNV, STR all set it).
  // Fall back to a point-containment check on POS for point-like records
  // and breakends. Guard against non-numeric END so malformed VCFs can't
  // silently poison the filter via NaN.
  if (filters.bedFilter !== undefined) {
    // A breakend's END, when a caller writes one, is its mate's coordinate:
    // POS..END is not a span of this chromosome.
    const isBreakend =
      record.info.get('SVTYPE') === 'BND' ||
      record.alt.some((alt) => alt.includes('[') || alt.includes(']'))
    const endRaw = isBreakend ? undefined : record.info.get('END')
    if (endRaw !== undefined && endRaw !== '') {
      // The whole token must be an integer: parseInt would read "5000junk" as 5000.
      const endPos = /^\d+$/.test(endRaw) ? Number(endRaw) : NaN
      if (Number.isSafeInteger(endPos) && endPos >= record.pos) {
        if (!filters.bedFilter.containsRange(record.chrom, record.pos, endPos)) {
          return false
        }
      } else {
        // Malformed END — degrade to point check on POS so we don't lose
        // the record on a single broken field.
        if (!filters.bedFilter.contains(record.chrom, record.pos)) return false
      }
    } else {
      if (!filters.bedFilter.contains(record.chrom, record.pos)) return false
    }
  }

  return true
}

/**
 * Check whether a mapped variant passes the post-mapping gate (FORMAT/GQ,
 * FORMAT/DP).
 *
 * These thresholds only apply to variants with a populated `gq` / `dp`
 * value — SV, CNV, and STR records with null fields pass through
 * unchanged. See the `ImportFilters` docstring for the full per-type
 * behavior matrix.
 */
export function passesPostMappingFilters(
  variant: VcfMappedVariant,
  filters: ImportFilters | undefined
): boolean {
  if (filters === undefined) return true
  if (filters.minGq !== null && variant.gq !== null && variant.gq < filters.minGq) {
    return false
  }
  if (filters.minDp !== null && variant.dp !== null && variant.dp < filters.minDp) {
    return false
  }
  return true
}

/**
 * Build the filters of one worker file request. The BED file is loaded here,
 * in the worker; a BED file that cannot be read fails the import rather than
 * importing unfiltered.
 */
export async function loadImportFilters(
  request: FileImportRequest['vcfFilters']
): Promise<ImportFilters | undefined> {
  if (request === undefined) return undefined
  const bedPadding = request.bedPadding ?? 0
  const bedPath = request.bedFilePath
  return {
    bedFilter:
      bedPath !== undefined && bedPath !== null && bedPath !== ''
        ? await BedFilter.fromFile(bedPath, bedPadding)
        : undefined,
    bedPadding,
    passOnly: request.passOnly ?? false,
    minQual: request.minQual ?? null,
    minGq: request.minGq ?? null,
    minDp: request.minDp ?? null
  }
}
