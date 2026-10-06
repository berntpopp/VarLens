import {
  EXTENSION_SORTABLE_DOTTED_KEYS,
  resolveExtensionColumnKey,
  type ExtensionTypeKey
} from '../variant-extension-registry'

/**
 * Columns living on the `variants` table that are sortable and eligible for
 * per-column metadata aggregation.
 *
 * Columns on the extension tables (variant_sv / variant_cnv / variant_str —
 * e.g. `sv.support`, `cnv.copy_number`) live in the extension registry under
 * dotted keys (`sv.support`) and are sortable per-type via
 * `EXTENSION_SORTABLE_DOTTED_KEYS`. `getAllColumnMetas` runs aggregate queries
 * directly against `variants` (no JOINs), so extension columns must NOT be
 * added here.
 */
export const BASE_SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  omim_mim_number: 'omim_mim_number',
  func: 'func',
  consequence: 'consequence',
  transcript: 'transcript',
  cdna: 'cdna',
  aa_change: 'aa_change',
  gt_num: 'gt_num',
  gnomad_af: 'gnomad_af',
  cadd: 'cadd',
  qual: 'qual',
  hpo_sim_score: 'hpo_sim_score',
  clinvar: 'clinvar',
  moi: 'moi',
  // Multi-variant type (SV/CNV/STR) discriminator columns — added in
  // migration v25 as real columns on the variants table. Without these
  // entries, clicking sort headers on the SV/CNV/STR tabs silently no-ops
  // because VariantFilterBuilder drops unknown sort keys and getAllColumnMetas
  // would not gather per-column metadata.
  variant_type: 'variant_type',
  end_pos: 'end_pos',
  sv_type: 'sv_type',
  sv_length: 'sv_length',
  caller: 'caller'
}

/**
 * Legacy alias — kept for back-compat with callers that imported
 * `SORTABLE_COLUMNS` before the base/extension split. Points at the same
 * object as `BASE_SORTABLE_COLUMNS`.
 */
export const SORTABLE_COLUMNS = BASE_SORTABLE_COLUMNS

/**
 * Resolve a sort key (either a base column name or a dotted extension key
 * like `cnv.copy_number`) to the SQL column reference and whether it targets
 * an extension table.
 *
 * Returns `null` for unknown keys. Caller uses the `isExtension` flag to
 * decide whether a LEFT JOIN must be added to the query.
 */
export function resolveSortColumn(
  sortKey: string
): { sql: string; isExtension: boolean; extensionType?: ExtensionTypeKey } | null {
  if (BASE_SORTABLE_COLUMNS[sortKey] !== undefined) {
    return { sql: `variants.${BASE_SORTABLE_COLUMNS[sortKey]}`, isExtension: false }
  }
  if (EXTENSION_SORTABLE_DOTTED_KEYS.has(sortKey)) {
    const resolved = resolveExtensionColumnKey(sortKey)
    if (resolved === null) return null
    return {
      sql: `${resolved.def.joinAlias}.${resolved.column}`,
      isExtension: true,
      extensionType: resolved.typeKey
    }
  }
  return null
}
