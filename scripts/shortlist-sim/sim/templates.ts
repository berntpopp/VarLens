/** Rule templates the harness can benchmark (spec §11.1 varvis, §16 varvis full). */
import { FULL_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/full-template'
import { VARVIS_EVIDENCE_TEMPLATE } from '../../../src/shared/config/evidence-rulesets/varvis-template'
import type { EvidenceRuleset } from '../../../src/shared/types/evidence-ruleset'

export const TEMPLATES = { varvis: VARVIS_EVIDENCE_TEMPLATE, full: FULL_EVIDENCE_TEMPLATE } as const
export type TemplateId = keyof typeof TEMPLATES
export const isTemplateId = (s: string): s is TemplateId => s in TEMPLATES
/** Fold rulesets (index = test fold) per tuned template. */
export type TunedByTemplate = Partial<Record<TemplateId, EvidenceRuleset[]>>
