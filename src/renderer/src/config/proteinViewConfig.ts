import { mdiMolecule, mdiPin } from '@mdi/js'

/**
 * Copy for the protein view entry points (details-panel strip and header
 * buttons, row quick menu, `p` shortcut). One source so every entry point
 * gives the same reason when the view cannot open.
 */
export const PROTEIN_VIEW_COPY = {
  lookupsOff: 'Protein view needs external lookups — an administrator can enable them in Settings',
  noVariant: 'Select a variant to open the protein view',
  noGene: 'No gene annotated for this variant',
  noProteinPosition: 'No protein position for this variant',
  loadFailed: 'Protein data could not be loaded',
  noDomain: 'no annotated domain'
} as const

/** Modal tabs, in display order; the strip and buttons open one directly. */
export type ProteinViewTab = 'lollipop' | 'gene-structure' | '3d'

/** Labelled buttons beside the gene name in the details panel (Gene structure: modal tab). */
export const PROTEIN_VIEW_BUTTONS: ReadonlyArray<{
  tab: ProteinViewTab
  label: string
  icon: string
}> = [
  { tab: 'lollipop', label: 'Lollipop', icon: mdiPin },
  { tab: '3d', label: '3D structure', icon: mdiMolecule }
]
