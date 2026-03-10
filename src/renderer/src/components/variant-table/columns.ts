import { computed, type ComputedRef } from 'vue'
import type { useColumnPreferences } from '../../composables/useColumnPreferences'
import { useVariantLinks } from '../../composables/useVariantLinks'

export interface ColumnDef {
  title: string
  key: string
  sortable: boolean
  width?: string
  align?: 'start' | 'end' | 'center'
}

/** Static base column definitions for the variant table. */
export const baseHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'OMIM', key: 'omim_mim_number', sortable: true, width: '100px' },
  { title: 'Func', key: 'func', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' },
  { title: 'CADD', key: 'cadd', sortable: true, align: 'end' },
  { title: 'Qual', key: 'qual', sortable: true, align: 'end' },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'HPO Score', key: 'hpo_sim_score', sortable: true, align: 'end' },
  { title: 'MoI', key: 'moi', sortable: true }
]

/**
 * Composable that computes dynamic, ordered, and visible column sets.
 */
export function useVariantColumns(prefs: ReturnType<typeof useColumnPreferences>['prefs']) {
  const { linksStore } = useVariantLinks()

  /** All headers including dynamic virtual link columns from store. */
  const headers: ComputedRef<ColumnDef[]> = computed(() => {
    const allHeaders: ColumnDef[] = [...baseHeaders]
    for (const link of linksStore.virtualLinks) {
      allHeaders.push({ title: link.name, key: `_link_${link.id}`, sortable: false, width: '80px' })
    }
    return allHeaders
  })

  /** Columns ordered by user preferences. */
  const orderedColumns = computed(() => {
    const base = headers.value
    if (prefs.value.order.length > 0) {
      return [...base].sort((a, b) => {
        const aIdx = prefs.value.order.indexOf(a.key)
        const bIdx = prefs.value.order.indexOf(b.key)
        if (aIdx === -1 && bIdx === -1) return 0
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })
    }
    return base
  })

  /** Only columns visible per user preferences. */
  const visibleHeaders = computed(() => {
    return orderedColumns.value.filter((h) => prefs.value.visibility[h.key] !== false)
  })

  /** Filterable columns: sortable data columns (exclude annotations, actions, link columns). */
  const filterableColumns = computed(() =>
    visibleHeaders.value.filter(
      (h) => h.sortable !== false && !h.key.startsWith('_link_') && h.key !== 'annotations'
    )
  )

  return { headers, orderedColumns, visibleHeaders, filterableColumns }
}
