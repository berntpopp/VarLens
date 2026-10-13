import { mdiDna, mdiLink, mdiMedicalBag, mdiSpeedometer, mdiTable, mdiTagMultiple } from '@mdi/js'
/**
 * Column group configurations for the Columns Drawer
 * Groups variant table columns by category for organized display
 */

export interface ColumnGroupConfig {
  id: string
  label: string
  icon: string
  /** Column keys that belong to this group (empty = catch-all for unrecognized columns) */
  keys: string[]
}

export const COLUMN_GROUPS: ColumnGroupConfig[] = [
  {
    id: 'core',
    label: 'Core Fields',
    icon: mdiTable,
    keys: ['chr', 'pos', 'ref', 'alt', 'gt_num']
  },
  {
    id: 'annotation',
    label: 'Annotation',
    icon: mdiDna,
    keys: ['gene_symbol', 'consequence', 'func', 'transcript', 'cdna', 'aa_change']
  },
  {
    id: 'scores',
    label: 'Scores',
    icon: mdiSpeedometer,
    keys: ['gnomad_af', 'cadd', 'qual']
  },
  {
    id: 'clinical',
    label: 'Clinical',
    icon: mdiMedicalBag,
    keys: ['clinvar', 'omim_mim_number', 'hpo_sim_score', 'hpo_match', 'moi']
  },
  {
    id: 'links',
    label: 'External Links',
    icon: mdiLink,
    keys: [] // Dynamically populated from columns not in other groups
  },
  {
    id: 'metadata',
    label: 'Metadata',
    icon: mdiTagMultiple,
    keys: ['annotations'] // Tags / annotations column
  }
]

/**
 * Get the group a column belongs to.
 * Columns not in any explicit group go to the 'links' group.
 */
export function getColumnGroup(columnKey: string): string {
  for (const group of COLUMN_GROUPS) {
    if (group.keys.includes(columnKey)) {
      return group.id
    }
  }
  return 'links' // Default: unrecognized columns go to links
}

/**
 * Group columns by their category, preserving order within groups.
 * Returns a Map ordered by COLUMN_GROUPS definition order.
 */
export function groupColumns(
  columns: { key: string; title: string }[]
): Map<string, { key: string; title: string }[]> {
  const grouped = new Map<string, { key: string; title: string }[]>()

  // Initialize groups in definition order
  for (const group of COLUMN_GROUPS) {
    grouped.set(group.id, [])
  }

  // Assign columns to groups
  for (const col of columns) {
    const groupId = getColumnGroup(col.key)
    const arr = grouped.get(groupId)
    if (arr) {
      arr.push(col)
    }
  }

  // Remove empty groups (except 'links' which may be empty if no virtual columns)
  for (const [key, value] of grouped) {
    if (value.length === 0 && key !== 'links') {
      grouped.delete(key)
    }
  }

  return grouped
}

/**
 * Look up a group config by id.
 */
export function getGroupConfig(groupId: string): ColumnGroupConfig | undefined {
  return COLUMN_GROUPS.find((g) => g.id === groupId)
}
