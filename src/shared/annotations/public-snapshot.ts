import { z } from 'zod'

const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/u
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,127}$/u
const CONTENT_HASH_PREFIX_LENGTH = 12
const FORBIDDEN_URL_QUERY_KEYS = new Set([
  'access_token',
  'api_key',
  'auth',
  'authorization',
  'key',
  'password',
  'secret',
  'session',
  'sig',
  'signature',
  'token'
])

const FORBIDDEN_PUBLIC_FIELD_PATTERNS = [
  /(^|_)case(_|$)/u,
  /(^|_)sample(_|$)/u,
  /(^|_)user(_|$)/u,
  /(^|_)workspace(_|$)/u,
  /(^|_)patient(_|$)/u,
  /(^|_)proband(_|$)/u,
  /(^|_)family(_|$)/u,
  /(^|_)pedigree(_|$)/u,
  /(^|_)subject(_|$)/u,
  /(^|_)individual(_|$)/u,
  /(^|_)phenotype(_|$)/u,
  /(^|_)affected(_|$)/u,
  /(^|_)query(_|$)/u,
  /(^|_)export(_|$)/u,
  /(^|_)genotype(_|$)/u,
  /(^|_)zygosity(_|$)/u,
  /(^|_)read_depth(_|$)/u,
  /(^|_)vaf(_|$)/u,
  /(^|_)local_path(_|$)/u,
  /(^|_)token(_|$)/u
] as const

const LicenseGateSchema = z.literal('fail-closed')
const LicenseStatusSchema = z.enum(['allowed', 'restricted', 'unknown'])
const RedistributionSchema = z.enum(['allowed', 'forbidden', 'unknown'])
const RedistributionClassSchema = z.enum([
  'public_redistributable',
  'attribution_public',
  'metadata_only',
  'private_escrow',
  'compute_only',
  'restricted',
  'prohibited'
])
const ClinicalUseSchema = z.enum(['allowed', 'separate_license', 'noncommercial_only', 'unknown'])
const DerivativeInheritanceSchema = z.enum(['none', 'attribution', 'share_alike', 'restricted', 'unknown'])
const PromotionEligibilitySchema = z.literal('public_snapshot')
const PublicStorageClassSchema = z.literal('public_reference_annotations')
const ImmutableSnapshotIdSchema = z
  .string()
  .regex(SNAPSHOT_ID_PATTERN)
  .refine((value) => !/(^|[._-])(latest|current|rolling)([._-]|$)/u.test(value), {
    message: 'snapshot ID must identify an immutable release, not latest/current/rolling'
  })
const RowCountKeySchema = z
  .string()
  .regex(FIELD_NAME_PATTERN)
  .refine((value) => !fieldNameLooksPrivate(value), {
    message: 'row count key must not look private or case-linked'
  })
const HttpsPublicUrlSchema = z.string().url().refine((value) => urlHasAllowedPublicShape(value), {
  message: 'URL must be https and must not contain credential-like query parameters'
})

const BLOCKED_PUBLIC_SOURCE_IDS = new Set([
  'dbnsfp',
  'omim',
  'mim',
  'spliceai',
  'cadd',
  'alphamissense',
  'panelapp',
  'orphanet',
  'decipher',
  'annotsv'
])

const BLOCKED_PUBLIC_SOURCE_PATTERNS = [
  /dbnsfp/u,
  /omim/u,
  /mim/u,
  /mendelian_inheritance/u,
  /inheritance_in_man/u,
  /spliceai/u,
  /cadd/u,
  /alphamissense/u,
  /panelapp/u,
  /orphanet/u,
  /decipher/u,
  /annotsv/u
] as const

const SAFE_ERROR_PATH_SEGMENTS = new Set([
  'schemaVersion',
  'snapshotId',
  'createdAt',
  'genomeBuild',
  'mappingVersion',
  'licenseGate',
  'licenseMatrix',
  'matrixId',
  'policyVersion',
  'matrixChecksum',
  'generatedAt',
  'mutableLatest',
  'privacy',
  'noPrivateData',
  'noCaseLinkedData',
  'noPrivateQueryHistory',
  'sources',
  'sourceId',
  'name',
  'version',
  'retrievedAt',
  'license',
  'licenseId',
  'url',
  'status',
  'redistribution',
  'redistributionClass',
  'clinicalUse',
  'derivativeInheritance',
  'shareAlike',
  'archivedTextChecksum',
  'attribution',
  'entries',
  'entryId',
  'fieldName',
  'sourceUrl',
  'accession',
  'licenseUrl',
  'provenanceUrl',
  'checksum',
  'fields',
  'dataType',
  'storageClass',
  'nullSemantics',
  'description',
  'promotionEligibility',
  'licenseStatus',
  'rowCounts',
  'manifestChecksum',
  'contentHash',
  'releaseReview',
  'reviewer',
  'reviewedAt',
  'evidenceChecksum'
])

const LicenseMatrixEntrySchema = z
  .object({
    entryId: z.string().regex(FIELD_NAME_PATTERN),
    sourceId: z.string().regex(FIELD_NAME_PATTERN),
    fieldName: z.string().regex(FIELD_NAME_PATTERN),
    sourceUrl: HttpsPublicUrlSchema,
    accession: z.string().min(1).optional(),
    licenseId: z.string().regex(FIELD_NAME_PATTERN),
    licenseUrl: HttpsPublicUrlSchema,
    archivedTextChecksum: z.string().regex(CHECKSUM_PATTERN),
    redistributionClass: RedistributionClassSchema,
    clinicalUse: ClinicalUseSchema,
    attribution: z.string().min(1),
    derivativeInheritance: DerivativeInheritanceSchema,
    shareAlike: z.boolean(),
    promotionEligibility: PromotionEligibilitySchema,
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime({ offset: true }),
    evidenceChecksum: z.string().regex(CHECKSUM_PATTERN)
  })
  .strict()

export const PublicAnnotationSourceSchema = z.object({
  sourceId: z.string().regex(FIELD_NAME_PATTERN),
  name: z.string().min(1),
  version: z.string().min(1),
  retrievedAt: z.string().datetime({ offset: true }).optional(),
  license: z
    .object({
      licenseId: z.string().regex(FIELD_NAME_PATTERN),
      name: z.string().min(1),
      url: HttpsPublicUrlSchema,
      status: LicenseStatusSchema,
      redistribution: RedistributionSchema,
      redistributionClass: RedistributionClassSchema,
      clinicalUse: ClinicalUseSchema,
      derivativeInheritance: DerivativeInheritanceSchema,
      shareAlike: z.boolean(),
      archivedTextChecksum: z.string().regex(CHECKSUM_PATTERN),
      attribution: z.string().min(1)
    })
    .strict(),
  provenanceUrl: HttpsPublicUrlSchema,
  checksum: z.string().regex(CHECKSUM_PATTERN)
}).strict()

export const PublicAnnotationFieldSchema = z.object({
  name: z.string().regex(FIELD_NAME_PATTERN),
  sourceId: z.string().regex(FIELD_NAME_PATTERN),
  dataType: z.enum(['boolean', 'integer', 'number', 'string', 'json']),
  storageClass: PublicStorageClassSchema,
  nullSemantics: z.string().min(1),
  description: z.string().min(1),
  promotionEligibility: PromotionEligibilitySchema,
  licenseStatus: z.literal('allowed')
}).strict()

export const PublicAnnotationSnapshotManifestSchema = z.object({
  schemaVersion: z.literal('varlens.public-annotation-snapshot.v1'),
  snapshotId: ImmutableSnapshotIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  genomeBuild: z.string().min(1),
  mappingVersion: z.string().min(1),
  licenseGate: LicenseGateSchema,
  licenseMatrix: z
    .object({
      matrixId: z.string().regex(FIELD_NAME_PATTERN),
      policyVersion: z.string().min(1),
      matrixChecksum: z.string().regex(CHECKSUM_PATTERN),
      generatedAt: z.string().datetime({ offset: true }),
      entries: z.array(LicenseMatrixEntrySchema).min(1)
    })
    .strict(),
  mutableLatest: z.literal(false),
  privacy: z
    .object({
      noPrivateData: z.literal(true),
      noCaseLinkedData: z.literal(true),
      noPrivateQueryHistory: z.literal(true)
    })
    .strict(),
  sources: z.array(PublicAnnotationSourceSchema).min(1),
  fields: z.array(PublicAnnotationFieldSchema).min(1),
  rowCounts: z.record(RowCountKeySchema, z.number().int().nonnegative()),
  manifestChecksum: z.string().regex(CHECKSUM_PATTERN),
  contentHash: z.string().regex(CHECKSUM_PATTERN),
  releaseReview: z
    .object({
      reviewer: z.string().min(1),
      reviewedAt: z.string().datetime({ offset: true }),
      evidenceChecksum: z.string().regex(CHECKSUM_PATTERN)
    })
    .strict()
}).strict()

export const PublicAnnotationSnapshotReferenceSchema = z
  .object({
    snapshotId: ImmutableSnapshotIdSchema,
    contentHash: z.string().regex(CHECKSUM_PATTERN),
    mappingVersion: z.string().min(1),
    manifestChecksum: z.string().regex(CHECKSUM_PATTERN),
    licenseMatrixChecksum: z.string().regex(CHECKSUM_PATTERN)
  })
  .strict()
  .superRefine((reference, context) => {
    const hashPrefix = reference.contentHash.slice(
      'sha256:'.length,
      'sha256:'.length + CONTENT_HASH_PREFIX_LENGTH
    )
    if (!reference.snapshotId.includes(hashPrefix)) {
      context.addIssue({
        code: 'custom',
        path: ['snapshotId'],
        message: 'snapshot ID must include the content hash prefix'
      })
    }
  })

export type PublicAnnotationSnapshotManifest = z.infer<
  typeof PublicAnnotationSnapshotManifestSchema
>
export type PublicAnnotationSnapshotReference = z.infer<
  typeof PublicAnnotationSnapshotReferenceSchema
>

export interface PublicAnnotationSnapshotValidationResult {
  ok: boolean
  manifest?: PublicAnnotationSnapshotManifest
  errors: string[]
}

function fieldNameLooksPrivate(name: string): boolean {
  const normalized = name.toLowerCase()
  const compact = normalized.replace(/_/gu, '')
  if (
    /(case|sample|user|workspace|patient|proband|family|pedigree|subject|individual|phenotype|affected|query|export|genotype|zygosity|readdepth|vaf|localpath|token)/u.test(
      compact
    )
  ) {
    return true
  }
  return FORBIDDEN_PUBLIC_FIELD_PATTERNS.some((pattern) => pattern.test(normalized))
}

function textLooksPrivate(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  return fieldNameLooksPrivate(normalized)
}

function textLooksBlockedForPublicSnapshot(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  const compact = normalized.replace(/_/gu, '')
  return (
    BLOCKED_PUBLIC_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    BLOCKED_PUBLIC_SOURCE_PATTERNS.some((pattern) => pattern.test(compact))
  )
}

function urlHasAllowedPublicShape(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') {
    return false
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return false
  }
  for (const key of parsed.searchParams.keys()) {
    if (queryKeyLooksCredentialLike(key)) {
      return false
    }
  }
  return true
}

function queryKeyLooksCredentialLike(key: string): boolean {
  const normalized = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  if (FORBIDDEN_URL_QUERY_KEYS.has(normalized)) {
    return true
  }
  const segments = normalized.split('_').filter(Boolean)
  return (
    segments.includes('token') ||
    segments.includes('password') ||
    segments.includes('secret') ||
    segments.includes('session') ||
    segments.includes('signature') ||
    normalized.endsWith('_access_token') ||
    normalized.endsWith('_api_key')
  )
}

function urlLooksBlockedForPublicSnapshot(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  return textLooksBlockedForPublicSnapshot(`${parsed.hostname}_${parsed.pathname}_${parsed.search}`)
}

function publicCompatibleMatrixPolicy(entry: {
  redistributionClass: z.infer<typeof RedistributionClassSchema>
  clinicalUse: z.infer<typeof ClinicalUseSchema>
  derivativeInheritance: z.infer<typeof DerivativeInheritanceSchema>
  shareAlike: boolean
  promotionEligibility: z.infer<typeof PromotionEligibilitySchema>
}): boolean {
  const publicRedistribution =
    entry.redistributionClass === 'public_redistributable' ||
    entry.redistributionClass === 'attribution_public'
  const publicDerivative =
    entry.derivativeInheritance === 'none' || entry.derivativeInheritance === 'attribution'
  return (
    publicRedistribution &&
    entry.clinicalUse === 'allowed' &&
    publicDerivative &&
    !entry.shareAlike &&
    entry.promotionEligibility === 'public_snapshot'
  )
}

function collectSemanticErrors(manifest: PublicAnnotationSnapshotManifest): string[] {
  const errors: string[] = []
  const sourceIds = new Set(manifest.sources.map((source) => source.sourceId))
  const sourcesById = new Map(manifest.sources.map((source) => [source.sourceId, source]))
  const fieldKeys = new Set(manifest.fields.map((field) => `${field.sourceId}\u0000${field.name}`))
  const hashPrefix = manifest.contentHash.slice('sha256:'.length, 'sha256:'.length + CONTENT_HASH_PREFIX_LENGTH)

  if (!manifest.snapshotId.includes(hashPrefix)) {
    errors.push('snapshot ID must include the content hash prefix')
  }

  const seenSourceIds = new Set<string>()
  for (const source of manifest.sources) {
    if (seenSourceIds.has(source.sourceId)) {
      errors.push('source ID is duplicated')
    }
    seenSourceIds.add(source.sourceId)
    if (
      BLOCKED_PUBLIC_SOURCE_IDS.has(source.sourceId) ||
      textLooksBlockedForPublicSnapshot(source.sourceId) ||
      textLooksBlockedForPublicSnapshot(source.name) ||
      textLooksBlockedForPublicSnapshot(source.version) ||
      textLooksBlockedForPublicSnapshot(source.license.licenseId) ||
      textLooksBlockedForPublicSnapshot(source.license.name) ||
      textLooksBlockedForPublicSnapshot(source.license.attribution) ||
      urlLooksBlockedForPublicSnapshot(source.license.url) ||
      urlLooksBlockedForPublicSnapshot(source.provenanceUrl)
    ) {
      errors.push('source is blocked for public snapshots until field-level clearance exists')
    }
    if (
      textLooksPrivate(source.sourceId) ||
      textLooksPrivate(source.name) ||
      textLooksPrivate(source.version) ||
      textLooksPrivate(source.license.licenseId) ||
      textLooksPrivate(source.license.name) ||
      textLooksPrivate(source.license.attribution)
    ) {
      errors.push('source metadata looks private and cannot be public')
    }
    if (source.license.status !== 'allowed') {
      errors.push('source license status must be allowed')
    }
    if (source.license.redistribution !== 'allowed') {
      errors.push('source redistribution must be allowed')
    }
    if (
      source.license.redistributionClass !== 'public_redistributable' &&
      source.license.redistributionClass !== 'attribution_public'
    ) {
      errors.push('source redistribution class must be public')
    }
    if (source.license.clinicalUse !== 'allowed') {
      errors.push('source clinical use must be allowed')
    }
    if (source.license.derivativeInheritance !== 'none' && source.license.derivativeInheritance !== 'attribution') {
      errors.push('source derivative inheritance must be public-compatible')
    }
    if (source.license.shareAlike) {
      errors.push('source share-alike must be false for public snapshot v1')
    }
  }

  const fieldNames = new Set<string>()
  for (const field of manifest.fields) {
    if (!sourceIds.has(field.sourceId)) {
      errors.push('field references unknown source')
    }
    if (fieldNameLooksPrivate(field.name)) {
      errors.push('field name looks private and cannot be public')
    }
    if (textLooksBlockedForPublicSnapshot(field.name)) {
      errors.push('field is blocked for public snapshots until field-level clearance exists')
    }
    if (textLooksPrivate(field.description) || textLooksPrivate(field.nullSemantics)) {
      errors.push('field metadata looks private and cannot be public')
    }
    if (fieldNames.has(field.name)) {
      errors.push('field name is duplicated')
    }
    fieldNames.add(field.name)
  }

  const matrixEntryKeys = new Set<string>()
  const matrixEntryIds = new Set<string>()
  for (const entry of manifest.licenseMatrix.entries) {
    const key = `${entry.sourceId}\u0000${entry.fieldName}`
    if (matrixEntryIds.has(entry.entryId)) {
      errors.push('license matrix entry ID is duplicated')
    }
    matrixEntryIds.add(entry.entryId)
    if (matrixEntryKeys.has(key)) {
      errors.push('license matrix field entry is duplicated')
    }
    matrixEntryKeys.add(key)
    if (!sourceIds.has(entry.sourceId)) {
      errors.push('license matrix entry references unknown source')
    }
    if (!fieldKeys.has(key)) {
      errors.push('license matrix entry references unknown field')
    }
    if (
      textLooksBlockedForPublicSnapshot(entry.entryId) ||
      textLooksBlockedForPublicSnapshot(entry.sourceId) ||
      textLooksBlockedForPublicSnapshot(entry.fieldName) ||
      textLooksBlockedForPublicSnapshot(entry.licenseId) ||
      textLooksBlockedForPublicSnapshot(entry.attribution) ||
      textLooksBlockedForPublicSnapshot(entry.reviewer) ||
      (entry.accession !== undefined && textLooksBlockedForPublicSnapshot(entry.accession)) ||
      urlLooksBlockedForPublicSnapshot(entry.sourceUrl) ||
      urlLooksBlockedForPublicSnapshot(entry.licenseUrl)
    ) {
      errors.push('license matrix entry is blocked for public snapshots')
    }
    if (
      textLooksPrivate(entry.entryId) ||
      textLooksPrivate(entry.sourceId) ||
      textLooksPrivate(entry.fieldName) ||
      textLooksPrivate(entry.licenseId) ||
      textLooksPrivate(entry.attribution) ||
      textLooksPrivate(entry.reviewer) ||
      (entry.accession !== undefined && textLooksPrivate(entry.accession))
    ) {
      errors.push('license matrix entry metadata looks private and cannot be public')
    }
    const source = sourcesById.get(entry.sourceId)
    if (
      source !== undefined &&
      (entry.licenseId !== source.license.licenseId ||
        entry.licenseUrl !== source.license.url ||
        entry.archivedTextChecksum !== source.license.archivedTextChecksum ||
        entry.attribution !== source.license.attribution)
    ) {
      errors.push('license matrix entry must match source license evidence')
    }
    if (!publicCompatibleMatrixPolicy(entry)) {
      errors.push('license matrix entry is not public eligible')
    }
  }

  if (
    textLooksBlockedForPublicSnapshot(manifest.releaseReview.reviewer) ||
    textLooksPrivate(manifest.releaseReview.reviewer)
  ) {
    errors.push('release review is blocked for public snapshots')
  }

  for (const key of fieldKeys) {
    if (!matrixEntryKeys.has(key)) {
      errors.push('field is missing license matrix entry')
    }
  }

  return errors
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path
    .map((segment) => {
      if (typeof segment === 'number') return String(segment)
      if (typeof segment === 'string') {
        return SAFE_ERROR_PATH_SEGMENTS.has(segment) ? segment : '<redacted>'
      }
      return '<redacted>'
    })
    .join('.')
  const prefix = path === '' ? 'manifest' : path
  if (issue.code === 'custom') {
    return `${prefix}: ${issue.message}`
  }
  return `${prefix}: ${issue.code}`
}

export function validatePublicAnnotationSnapshotManifest(
  input: unknown
): PublicAnnotationSnapshotValidationResult {
  const parsed = PublicAnnotationSnapshotManifestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => formatZodIssue(issue))
    }
  }

  const errors = collectSemanticErrors(parsed.data)
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, manifest: parsed.data, errors: [] }
}

export function assertPublicAnnotationSnapshotManifest(
  input: unknown
): PublicAnnotationSnapshotManifest {
  const result = validatePublicAnnotationSnapshotManifest(input)
  if (!result.ok || result.manifest === undefined) {
    throw new Error(`Invalid public annotation snapshot manifest: ${result.errors.join('; ')}`)
  }
  return result.manifest
}
