import { computed } from 'vue'
import type { useColumnPreferences } from '../../composables/useColumnPreferences'
import { linksColumn, type ColumnDef } from '../variant-table/columns'
import { withFixedWidth } from '../variant-table/column-widths'
import { useAutoHiddenColumns } from '../../composables/useResponsiveLayout'
import { useExternalLinksStore } from '../../stores/externalLinksStore'

/**
 * Static base column definitions for the cohort table. Same clinical-first
 * order as the case table (ClinVar/gnomAD right after Gene/Consequence).
 */
export const baseHeaders: ColumnDef[] = [
  { title: '', key: 'data-table-expand', sortable: false, width: '40px' },
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Ref', key: 'ref', sortable: false, width: '80px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '80px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Impact', key: 'consequence', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' },
  { title: 'CADD', key: 'cadd_phred', sortable: true, align: 'end' },
  { title: 'Carriers', key: 'carrier_count', sortable: true, align: 'end' },
  { title: 'Cohort Freq', key: 'cohort_frequency', sortable: true, align: 'end' },
  { title: 'Het / Hom', key: 'het_count', sortable: true },
  { title: 'Consequence', key: 'func', sortable: true },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true }
]

/**
 * Composable that computes dynamic, ordered, and visible column sets for the cohort table.
 * Columns without an explicit visibility preference follow the responsive
 * default from `useAutoHiddenColumns`, exactly like the case table.
 */
export function useCohortColumns(prefs: ReturnType<typeof useColumnPreferences>['prefs']) {
  const linksStore = useExternalLinksStore()

  /** Base columns plus the merged Links column (parity with the case table). */
  const headers = computed<ColumnDef[]>(() => [
    ...baseHeaders,
    ...linksColumn(linksStore.virtualLinks.length)
  ])

  /** Columns ordered by user preferences. */
  const orderedColumns = computed(() => {
    if (prefs.value.order.length > 0) {
      return [...headers.value].sort((a, b) => {
        const aIdx = prefs.value.order.indexOf(a.key)
        const bIdx = prefs.value.order.indexOf(b.key)
        if (aIdx === -1 && bIdx === -1) return 0
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })
    }
    return headers.value
  })

  // Responsive default for columns without an explicit choice (parity with the case table)
  const { isVisible } = useAutoHiddenColumns(() => headers.value.map((h) => h.key), prefs)

  /** Only columns visible per user preferences, with shared fixed widths (no jitter). */
  const visibleHeaders = computed(() =>
    orderedColumns.value.filter((h) => isVisible(h.key)).map(withFixedWidth)
  )

  return { orderedColumns, visibleHeaders, isVisible }
}
