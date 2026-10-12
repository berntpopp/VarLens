/**
 * Zod schemas for the evidence ruleset (spec §3.4). Structural only: rule
 * texts are compiled and cross-checked by the main-process ruleset compiler.
 */
import { z } from 'zod'
import { EVIDENCE_MODE_ORDER } from './evidence-ruleset'

const ModeIdSchema = z.enum(EVIDENCE_MODE_ORDER)
const IdSchema = z.string().regex(/^[a-z0-9_.-]{1,64}$/)
const LabelSchema = z.string().min(1).max(120)
const RuleTextSchema = z.string().min(1).max(500)
const PointsSchema = z
  .number()
  .min(-20)
  .max(20)
  .refine((n) => Number.isInteger(n * 2), 'points must be in steps of 0.5')

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
  rules: z.array(EvidenceRuleSchema).min(1).max(20)
})

export const ModeProfileSchema = z.object({
  id: ModeIdSchema,
  label: LabelSchema,
  when: RuleTextSchema.nullable(),
  points: PointsSchema
})

export const EvidenceRulesetSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(64),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  modes: z.array(ModeProfileSchema).min(1).max(EVIDENCE_MODE_ORDER.length),
  groups: z.array(EvidenceGroupSchema).max(40)
})
