/** User-facing copy for case phenotype terms (present / key / excluded, spec 2026-10-14 §4). */
export const HPO_TERM_COPY = {
  /** Visible prefix on excluded terms, so the state never relies on colour. */
  excludedPrefix: 'no ',
  present: 'Present',
  excluded: 'Excluded',
  excludedMenu: 'Excluded (examined, absent)',
  key: 'Key finding',
  /** Lower-case state for screen-reader text and chip labels. */
  keyState: 'key finding',
  keyGroup: 'Key',
  remove: 'Remove',
  presentGroup: 'Present phenotypes',
  excludedGroup: 'Excluded phenotypes',
  empty: 'No phenotype terms assigned',
  placeholder: 'Type a term or HPO ID · Enter present · Shift+Enter excluded',
  chipShortcuts: 'x excluded · k key · Del remove',
  menuLabel: (label: string): string => `Status of ${label}`,
  bannerEmpty: 'No clinical phenotypes recorded',
  bannerOnlyExcluded: 'No present phenotypes · phenotype score inactive'
} as const
