import { z } from 'zod'

import {
  PublicAnnotationSnapshotReferenceSchema,
  type PublicAnnotationSnapshotReference
} from './public-snapshot'

const BUNDLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/u
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u
const RELATIVE_BUNDLE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,511}$/u

export const AnnotationBundleFileRoleSchema = z.enum([
  'snv_vcf',
  'sv_vcf',
  'cnv_vcf',
  'str_vcf',
  'annotsv_tsv',
  'straglr_tsv',
  'report',
  'manifest'
])

export const AnnotationBundleFileSchema = z
  .object({
    role: AnnotationBundleFileRoleSchema,
    path: z
      .string()
      .regex(RELATIVE_BUNDLE_PATH_PATTERN)
      .refine((value) => !pathEscapesBundle(value), {
        message: 'bundle file path must be relative and must not escape the bundle root'
      }),
    checksum: z.string().regex(CHECKSUM_PATTERN),
    sizeBytes: z.number().int().nonnegative(),
    required: z.boolean(),
    indexPath: z
      .string()
      .regex(RELATIVE_BUNDLE_PATH_PATTERN)
      .refine((value) => !pathEscapesBundle(value), {
        message: 'bundle index path must be relative and must not escape the bundle root'
      })
      .optional(),
    indexChecksum: z.string().regex(CHECKSUM_PATTERN).optional(),
    indexSizeBytes: z.number().int().nonnegative().optional(),
    formatVersion: z.string().min(1).optional()
  })
  .strict()

export const AnnotationBundleToolSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    commandLineChecksum: z.string().regex(CHECKSUM_PATTERN).optional()
  })
  .strict()

export const AnnotationBundleManifestSchema = z
  .object({
    schemaVersion: z.literal('varlens.annotation-bundle.v1'),
    bundleId: z
      .string()
      .regex(BUNDLE_ID_PATTERN)
      .refine((value) => !/(^|[._-])(latest|current|rolling)([._-]|$)/u.test(value), {
        message: 'bundle ID must identify an immutable release, not latest/current/rolling'
      }),
    createdAt: z.string().datetime({ offset: true }),
    genomeBuild: z.string().min(1),
    mappingVersion: z.string().min(1),
    publicSnapshot: PublicAnnotationSnapshotReferenceSchema,
    files: z.array(AnnotationBundleFileSchema).min(1),
    tools: z.array(AnnotationBundleToolSchema).default([]),
    importOrder: z.array(AnnotationBundleFileRoleSchema).min(1),
    privacy: z
      .object({
        privateCaseData: z.literal(true),
        publicSnapshotReferenceOnly: z.literal(true)
      })
      .strict(),
    checksums: z
      .object({
        manifest: z.string().regex(CHECKSUM_PATTERN),
        inventory: z.string().regex(CHECKSUM_PATTERN)
      })
      .strict()
  })
  .strict()

export type AnnotationBundleFileRole = z.infer<typeof AnnotationBundleFileRoleSchema>
export type AnnotationBundleFile = z.infer<typeof AnnotationBundleFileSchema>
export type AnnotationBundleManifest = z.infer<typeof AnnotationBundleManifestSchema>

export interface AnnotationBundleValidationResult {
  ok: boolean
  manifest?: AnnotationBundleManifest
  importPlan?: AnnotationBundleImportPlan
  errors: string[]
}

export interface AnnotationBundleImportPlan {
  bundleId: string
  genomeBuild: string
  mappingVersion: string
  publicSnapshot: PublicAnnotationSnapshotReference
  orderedFiles: AnnotationBundleFile[]
  variantFiles: AnnotationBundleFile[]
  sidecarFiles: AnnotationBundleFile[]
  reportFiles: AnnotationBundleFile[]
}

const VARIANT_ROLES = new Set<AnnotationBundleFileRole>(['snv_vcf', 'sv_vcf', 'cnv_vcf', 'str_vcf'])
const SIDECAR_ROLES = new Set<AnnotationBundleFileRole>(['annotsv_tsv', 'straglr_tsv'])
const REPORT_ROLES = new Set<AnnotationBundleFileRole>(['report', 'manifest'])

function pathEscapesBundle(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

function formatBundleIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.join('.')
  const prefix = path === '' ? 'bundle' : path
  if (issue.code === 'custom') {
    return `${prefix}: ${issue.message}`
  }
  return `${prefix}: ${issue.code}`
}

function collectBundleSemanticErrors(manifest: AnnotationBundleManifest): string[] {
  const errors: string[] = []
  const filesByRole = new Map<AnnotationBundleFileRole, AnnotationBundleFile[]>()
  const paths = new Set<string>()

  for (const file of manifest.files) {
    if (paths.has(file.path)) {
      errors.push('bundle file path is duplicated')
    }
    paths.add(file.path)
    const roleFiles = filesByRole.get(file.role) ?? []
    roleFiles.push(file)
    filesByRole.set(file.role, roleFiles)

    if (file.role.endsWith('_vcf') && file.indexPath === undefined) {
      errors.push(`${file.role} requires an indexPath`)
    }
    if (file.indexPath !== undefined && file.indexChecksum === undefined) {
      errors.push(`${file.role} indexPath requires an indexChecksum`)
    }
    if (file.indexPath !== undefined && file.indexSizeBytes === undefined) {
      errors.push(`${file.role} indexPath requires indexSizeBytes`)
    }
    if (file.indexPath === undefined && (file.indexChecksum !== undefined || file.indexSizeBytes !== undefined)) {
      errors.push(`${file.role} index integrity fields require an indexPath`)
    }
  }

  if (!filesByRole.has('manifest')) {
    errors.push('bundle must include its source manifest file')
  }
  if (!filesByRole.has('report')) {
    errors.push('bundle must include a report file')
  }
  if (![...VARIANT_ROLES].some((role) => filesByRole.has(role))) {
    errors.push('bundle must include at least one variant VCF')
  }

  for (const role of manifest.importOrder) {
    if (!filesByRole.has(role)) {
      errors.push(`importOrder references missing role ${role}`)
    }
  }

  for (const [role, roleFiles] of filesByRole.entries()) {
    const requiredCount = roleFiles.filter((file) => file.required).length
    if (requiredCount === 0 && REPORT_ROLES.has(role)) {
      errors.push(`${role} must have at least one required file`)
    }
  }
  if ([...VARIANT_ROLES].every((role) => (filesByRole.get(role) ?? []).every((file) => !file.required))) {
    errors.push('bundle must include at least one required variant VCF')
  }

  return errors
}

function buildImportPlan(manifest: AnnotationBundleManifest): AnnotationBundleImportPlan {
  const rankByRole = new Map(manifest.importOrder.map((role, index) => [role, index]))
  const rankedFiles = [...manifest.files].sort((left, right) => {
    const leftRank = rankByRole.get(left.role) ?? Number.MAX_SAFE_INTEGER
    const rightRank = rankByRole.get(right.role) ?? Number.MAX_SAFE_INTEGER
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.path.localeCompare(right.path)
  })

  return {
    bundleId: manifest.bundleId,
    genomeBuild: manifest.genomeBuild,
    mappingVersion: manifest.mappingVersion,
    publicSnapshot: manifest.publicSnapshot,
    orderedFiles: rankedFiles,
    variantFiles: rankedFiles.filter((file) => VARIANT_ROLES.has(file.role)),
    sidecarFiles: rankedFiles.filter((file) => SIDECAR_ROLES.has(file.role)),
    reportFiles: rankedFiles.filter((file) => REPORT_ROLES.has(file.role))
  }
}

export function validateAnnotationBundleManifest(input: unknown): AnnotationBundleValidationResult {
  const parsed = AnnotationBundleManifestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => formatBundleIssue(issue))
    }
  }

  const errors = collectBundleSemanticErrors(parsed.data)
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    manifest: parsed.data,
    importPlan: buildImportPlan(parsed.data),
    errors: []
  }
}

export function assertAnnotationBundleManifest(input: unknown): AnnotationBundleManifest {
  const result = validateAnnotationBundleManifest(input)
  if (!result.ok || result.manifest === undefined) {
    throw new Error(`Invalid annotation bundle manifest: ${result.errors.join('; ')}`)
  }
  return result.manifest
}
