import type { ColumnFilterMeta, ColumnFilterMode } from '../../../shared/types/column-filters'

/**
 * Default threshold: columns with this many or fewer distinct values
 * get categorical (checkbox) filter mode.
 */
export const DEFAULT_CATEGORICAL_THRESHOLD = 25

/**
 * Per-column overrides for filter mode auto-detection.
 * forceMode: skip auto-detection and always use this mode.
 * threshold: override the categorical threshold for this column.
 */
export const COLUMN_FILTER_OVERRIDES: Record<
  string,
  { forceMode?: ColumnFilterMode; threshold?: number }
> = {
  gene_symbol: { forceMode: 'text-suggest' },
  chr: { forceMode: 'categorical' },
  gt_num: { forceMode: 'categorical' },
  pos: { forceMode: 'numeric' },
  gnomad_af: { forceMode: 'numeric' },
  cadd: { forceMode: 'numeric' },
  qual: { forceMode: 'numeric' },
  hpo_sim_score: { forceMode: 'numeric' }
}

/**
 * Auto-detect the filter mode for a column based on its metadata.
 *
 * Priority:
 * 1. Config override (forceMode) — always wins
 * 2. Numeric data type — always numeric (never downgrade to categorical)
 * 3. Distinct count <= threshold — categorical
 * 4. Fallback — text-suggest
 */
export function detectFilterMode(meta: ColumnFilterMeta): ColumnFilterMode {
  const override = COLUMN_FILTER_OVERRIDES[meta.key]

  // 1. Forced mode from config
  if (override?.forceMode) {
    return override.forceMode
  }

  // 2. Numeric type — always numeric, even with few distinct values
  if (meta.dataType === 'numeric') {
    return 'numeric'
  }

  // 3. Few distinct values -> categorical
  const threshold = override?.threshold ?? DEFAULT_CATEGORICAL_THRESHOLD
  if (meta.distinctCount <= threshold) {
    return 'categorical'
  }

  // 4. Text type with many values -> text-suggest
  return 'text-suggest'
}
