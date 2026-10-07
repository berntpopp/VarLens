import { computed, type ComputedRef, type Ref } from 'vue'
import type { useColumnPreferences } from '../../composables/useColumnPreferences'
import { useExternalLinksStore } from '../../stores/externalLinksStore'
import { LINKS_COLUMN_KEY, linksColumnWidthRem } from '../../utils/link-outs'
import { svHeaders } from './sv-columns'
import { cnvHeaders } from './cnv-columns'
import { strHeaders } from './str-columns'
import { withFixedWidth } from './column-widths'
import { useAutoHiddenColumns } from '../../composables/useResponsiveLayout'

export interface ColumnDef {
  title: string
  key: string
  sortable: boolean
  width?: string
  align?: 'start' | 'end' | 'center'
  /**
   * Optional value getter. When set, Vuetify reads this function instead of
   * `item[key]` for cell content. Required for extension columns where the
   * sort key (dotted, e.g. `sv.support`) differs from the row property name
   * (the SELECT projection alias, e.g. `_sv_support`). Vuetify 3 treats a
   * dotted `key` string as a nested path accessor via `getObjectValueByPath`
   * — without this getter, `item['sv']['support']` resolves to undefined and
   * the cell renders empty.
   *
   * Parameter type is `any` to remain assignable to Vuetify's
   * `SelectItemKey<Variant>` function branch — Vuetify expects
   * `(item: Variant, fallback?: any) => any`, which is stricter than
   * `Record<string, unknown>` (Variant has no index signature). Callers
   * narrow the item shape via type assertion inside the getter.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: (item: any) => unknown
}

/**
 * Returns the appropriate column definitions for a given variant type.
 * Used by the variant table tabs to swap column sets when switching between
 * SNV/Indel, SV, CNV, and STR views.
 */
export function getHeadersForType(variantType: string): ColumnDef[] {
  switch (variantType) {
    case 'sv':
      return svHeaders
    case 'cnv':
      return cnvHeaders
    case 'str':
      return strHeaders
    default:
      return baseHeaders
  }
}

/**
 * Static base column definitions for the variant table. ClinVar and gnomAD AF
 * sit right after Gene/Consequence so the clinically critical columns are on
 * screen at 1366 px (audit 06 §3.2); a saved user order still wins.
 */
export const baseHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Impact', key: 'consequence', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' },
  { title: 'CADD', key: 'cadd', sortable: true, align: 'end' },
  { title: 'Consequence', key: 'func', sortable: true },
  { title: 'OMIM', key: 'omim_mim_number', sortable: true, width: '100px' },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true },
  { title: 'Qual', key: 'qual', sortable: true, align: 'end' },
  { title: 'HPO Score', key: 'hpo_sim_score', sortable: true, align: 'end' },
  { title: 'MoI', key: 'moi', sortable: true }
]

/**
 * The merged Links column (one icon link per `virtual` external link), or
 * nothing when no such link is enabled. Shared by case, cohort and shortlist.
 */
export function linksColumn(linkCount: number): ColumnDef[] {
  if (linkCount === 0) return []
  return [
    {
      title: 'Links',
      key: LINKS_COLUMN_KEY,
      sortable: false,
      width: `${linksColumnWidthRem(linkCount)}rem`
    }
  ]
}

/**
 * Composable that computes dynamic, ordered, and visible column sets.
 *
 * @param prefs - Column preferences from useColumnPreferences
 * @param variantType - Optional reactive variant type; swaps base column set when
 *   set to 'sv', 'cnv', or 'str'. Defaults to SNV/Indel columns.
 *
 * Columns without an explicit visibility preference follow the responsive
 * default from `useAutoHiddenColumns` (lowest-priority columns hidden on
 * narrower viewports).
 */
export function useVariantColumns(
  prefs: ReturnType<typeof useColumnPreferences>['prefs'],
  variantType?: Ref<string> | ComputedRef<string>
) {
  const linksStore = useExternalLinksStore()

  /** All headers including the merged Links column (SNV/Indel view only). */
  const headers: ComputedRef<ColumnDef[]> = computed(() => {
    const type = variantType?.value ?? 'snv'
    const typeHeaders = getHeadersForType(type)
    // Type-specific views (SV/CNV/STR) have curated columns and no link-outs
    if (type !== 'snv') return typeHeaders
    return [...typeHeaders, ...linksColumn(linksStore.virtualLinks.length)]
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

  const { isVisible } = useAutoHiddenColumns(() => headers.value.map((h) => h.key), prefs)

  /** Only columns visible per user preferences, with shared fixed widths (no jitter). */
  const visibleHeaders = computed(() =>
    orderedColumns.value.filter((h) => isVisible(h.key)).map(withFixedWidth)
  )

  /** Filterable columns: sortable data columns (exclude annotations and the Links column). */
  const filterableColumns = computed(() =>
    visibleHeaders.value.filter(
      (h) => h.sortable !== false && h.key !== LINKS_COLUMN_KEY && h.key !== 'annotations'
    )
  )

  return { headers, orderedColumns, visibleHeaders, filterableColumns }
}
