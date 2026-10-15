/**
 * Copy and editor defaults of the "Shortlist ranking" settings dialog
 * (spec §12). Domain values (modes, limits, points scale, gate, template) live
 * in `src/shared/config/shortlist-evidence.config.ts`; this file holds only
 * what the dialog says and how it starts.
 */
import { TRANSCRIPT_IMPACT_VALUES } from '../../../shared/types/transcript'

export const SHORTLIST_RANKING_EDITOR = {
  title: 'Shortlist ranking',
  listHeading: 'Rankings',
  labels: {
    evidence: 'Evidence',
    legacy: 'Weighted',
    builtIn: 'Built-in, read-only',
    unsaved: 'Unsaved',
    reference: 'Reference'
  },
  actions: {
    newRanking: 'New',
    importRanking: 'Import',
    exportRanking: 'Export',
    duplicate: 'Duplicate to edit',
    copy: 'Duplicate',
    deleteRanking: 'Delete',
    addRule: 'Add rule',
    addGroup: 'Add group',
    removeGroup: 'Remove group',
    removeRule: 'Remove rule',
    moveUp: 'Move up',
    moveDown: 'Move down',
    cancel: 'Close',
    save: 'Save',
    runPreview: 'Run preview',
    rerunPreview: 'Update preview',
    editRanking: 'Edit ranking',
    togglePreview: 'Preview'
  },
  defaultRanking: {
    label: 'Default for the shortlist',
    hint: 'The Shortlist tab opens with this ranking.',
    none: 'First in the list'
  },
  fields: {
    name: 'Name',
    description: 'Description',
    maxGnomadAf: 'gnomAD AF ≤',
    impacts: 'Impact',
    variantTypes: 'Types',
    topN: 'Show top',
    considerPhasing: 'Consider phased variants',
    considerPhasingHint: 'Labels compound-het pairs cis or trans when VCF FORMAT PS is present.',
    label: 'Label',
    condition: 'Condition',
    points: 'Points',
    scope: 'Applies under'
  },
  sections: {
    candidates: 'Candidates',
    candidatesHelp: 'Only variants passing these filters are scored.',
    otherFilters: 'Also filtered by',
    modes: 'Inheritance modes',
    modesHelp:
      'Checked in this fixed order: the first matching mode applies and its points are added once.',
    groups: 'Evidence groups',
    groupsHelp:
      'In each group the first matching rule wins. The pinned reference rule catches everything else.',
    preview: 'Preview on the open case',
    previewHelp: 'Top rows under the edited ranking; Δ is the change against the saved ranking.',
    previewNoCase: 'Open a case to preview this ranking.',
    previewStale: 'The ranking changed since this preview.',
    legacyHelp:
      'This ranking uses weighted scores, which this editor does not change. Duplicate it to start an evidence ranking with its candidate filters.'
  },
  scopeGlobal: 'All modes',
  ruleCount: (n: number): string => `${n} rule${n === 1 ? '' : 's'}`,
  fallbackCondition: 'When no mode above matches',
  conditionPlaceholder: 'e.g. cadd:>=:25 AND gnomad_af:<:0.001',
  atCharacter: (n: number): string => ` (at character ${n})`,
  previewColumns: { rank: '#', gene: 'Gene', variant: 'Variant', points: 'Points', delta: 'Δ' },
  previewNew: 'new',
  deltaLabel: (n: number): string =>
    n > 0 ? `up ${n} places` : n < 0 ? `down ${-n} places` : 'same place',
  announceMoved: (label: string, position: number): string =>
    `${label} moved to position ${position}`,
  /** A rule reads hpo_resnik but the HPO reference data is missing (#600). */
  hpoDataMissing:
    'This ranking uses hpo_resnik, but HPO data is not installed or needs an update, so ' +
    'hpo_resnik is empty for every variant, and excluded or key phenotype terms have no ' +
    'effect.',
  /** Where to get HPO data: in the app, or (web) from the server operator. */
  hpoDataInstall: 'Install it under Gene panels → HPO data.',
  hpoDataAskAdmin: 'Ask your administrator to install HPO data (npm run build:hpo-db).',
  errors: {
    count: (n: number): string => `${n} problem${n === 1 ? '' : 's'}`,
    nameRequired: 'A name is required',
    nameTaken: 'Another preset already has this name',
    importFormat: 'Not a VarLens shortlist ranking file',
    importNotEvidence: 'The file holds no evidence ruleset',
    importInvalid: (detail: string): string => `The ranking in the file is invalid: ${detail}`
  },
  confirm: {
    discard: 'Discard the unsaved changes to this ranking?',
    remove: (name: string): string => `Delete the ranking "${name}"?`,
    removeGroup: (label: string, rules: number): string =>
      `Remove the group "${label}" and its ${rules} rules?`
  },
  saved: (name: string): string => `Ranking "${name}" saved`,
  copySuffix: 'copy',
  newRankingName: 'My evidence ranking',
  newGroupLabel: 'New group',
  newRuleLabel: 'New rule',
  newRuleWhen: 'cadd:>=:20',
  newRulePoints: 1,
  referenceRuleLabel: 'Anything else (reference)',
  exportFormat: 'varlens-shortlist-ranking',
  previewRows: 10,
  impactLevels: TRANSCRIPT_IMPACT_VALUES,
  afStep: 0.001
} as const
