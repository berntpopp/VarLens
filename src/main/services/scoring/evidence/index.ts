/**
 * Evidence-rule shortlist engine (spec §3). Pure: no database access. Must
 * not import `../index.ts` (the legacy scorer imports nothing from here).
 */
export {
  compileRuleset,
  validateEvidenceConfig,
  EvidenceRulesetError,
  type CompiledRuleset
} from './ruleset'
export { scoreEvidenceRow, type EvidenceScore } from './score'
export {
  GeneContextBuilder,
  deriveZygosity,
  alleleKey,
  type CaseInfo,
  type CaseSex,
  type DerivedFields,
  type GeneContext,
  type LightRow,
  type Zygosity
} from './case-context'
export type {
  EvidenceContribution,
  EvidenceGroup,
  EvidenceRule,
  EvidenceRuleset,
  ModeId,
  ModeProfile
} from '../../../../shared/types/evidence-ruleset'
