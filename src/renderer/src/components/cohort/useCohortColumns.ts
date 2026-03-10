import { computed } from 'vue'
import type { useColumnPreferences } from '../../composables/useColumnPreferences'
import type { ColumnDef } from '../variant-table/columns'

/** Static base column definitions for the cohort table. */
export const baseHeaders: ColumnDef[] = [
  { title: '', key: 'data-table-expand', sortable: false, width: '40px' },
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Ref', key: 'ref', sortable: false, width: '80px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '80px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'Func', key: 'func', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' },
  { title: 'CADD', key: 'cadd_phred', sortable: true, align: 'end' },
  { title: 'Carriers', key: 'carrier_count', sortable: true, align: 'end' },
  { title: 'Cohort Freq', key: 'cohort_frequency', sortable: true, align: 'end' },
  { title: 'Het / Hom', key: 'het_count', sortable: true }
]

/**
 * Composable that computes dynamic, ordered, and visible column sets for the cohort table.
 */
export function useCohortColumns(prefs: ReturnType<typeof useColumnPreferences>['prefs']) {
  /** Columns ordered by user preferences. */
  const orderedColumns = computed(() => {
    if (prefs.value.order.length > 0) {
      return [...baseHeaders].sort((a, b) => {
        const aIdx = prefs.value.order.indexOf(a.key)
        const bIdx = prefs.value.order.indexOf(b.key)
        if (aIdx === -1 && bIdx === -1) return 0
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })
    }
    return baseHeaders
  })

  /** Only columns visible per user preferences. */
  const visibleHeaders = computed(() => {
    return orderedColumns.value.filter((h) => prefs.value.visibility[h.key] !== false)
  })

  return { orderedColumns, visibleHeaders }
}
