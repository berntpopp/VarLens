/**
 * Zod schemas for the evidence ruleset (spec §3.4). Structural only: rule
 * texts are compiled and cross-checked by the main-process ruleset compiler.
 */
import { z } from 'zod'
import { EVIDENCE_MODE_ORDER } from './evidence-ruleset'
import { SHORTLIST_EVIDENCE_CONFIG } from '../config/shortlist-evidence.config'

const { limits, points } = SHORTLIST_EVIDENCE_CONFIG

const ModeIdSchema = z.enum(EVIDENCE_MODE_ORDER)
const IdSchema = z.string().regex(limits.idPattern)
const LabelSchema = z.string().min(1).max(limits.labelChars)
const RuleTextSchema = z.string().min(1).max(limits.ruleChars)
const PointsSchema = z
  .number()
  .min(points.min)
  .max(points.max)
  .refine((n) => Number.isInteger(n / points.step), `points must be in steps of ${points.step}`)

export const EvidenceRuleSchema = z.object({
  id: IdSchema,
  label: LabelSchema,
  when: RuleTextSchema,
  points: PointsSchema
})

export const EvidenceGroupSchema = z.object({
  id: IdSchema,
  label: LabelSchema,
  scope: z.union([z.literal('global'), ModeIdSchema]),
  rules: z.array(EvidenceRuleSchema).min(1).max(limits.rulesPerGroup)
})

export const ModeProfileSchema = z.object({
  id: ModeIdSchema,
  label: LabelSchema,
  when: RuleTextSchema.nullable(),
  points: PointsSchema
})

export const EvidenceRulesetSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(limits.rulesetIdChars),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  modes: z.array(ModeProfileSchema).min(1).max(EVIDENCE_MODE_ORDER.length),
  groups: z.array(EvidenceGroupSchema).max(limits.groups)
})
