/**
 * THE web security map: one policy for every operation the web server serves
 * (spec §4.1 L3; Limin `api-security-map.ts`). `secure()` (secure.ts) applies
 * it to every dispatcher call and to the few non-dispatcher HTTP routes, so
 * authorization and auditing are decided here and nowhere else.
 *
 * Role model (shared data, role-gated writes):
 *   viewer   read everything; no writes except self-service (own password,
 *            sign-out, cancelling an in-flight lookup)
 *   analyst  viewer + classify / comment / tag / curate / import / export
 *   admin    analyst + users, audit trail, delete-all, cache/egress config
 *
 * Keys are `<kebab-domain>:<method>` exactly as the dispatcher resolves them;
 * `http:*` keys name the non-dispatcher routes. A dispatcher key without an
 * entry is refused (fail closed) and fails
 * tests/web-gate/operation-security-registry.test.ts.
 */
import {
  read,
  readAuditedByHandler,
  readExempt,
  write,
  writeAuditedByHandler,
  writeExempt,
  type OperationPolicy
} from './operation-policy'

const POLL = 'High-frequency status poll; ids and counters only, no clinical data.'
const BATCH_POLL =
  'Status poll of the caller’s own batch import; the start of the batch is the audited write.'
const SELF_SESSION = 'Reads only the caller’s own session identity.'
const CAPABILITY = 'Backend capability/health probe; no clinical data.'
const EGRESS_AUDIT = 'api_read reference lookup (egress audit, allowed or blocked)'
const CANCEL_LOOKUP = 'Aborts the caller’s own in-flight request; changes no stored data.'

/** Methods the dispatcher serves (overrides and read/write autoroutes). */
export const DISPATCHER_SECURITY_MAP: Readonly<Record<string, OperationPolicy>> = Object.freeze({
  // ── auth ────────────────────────────────────────────────────────────────
  'auth:login': writeAuditedByHandler('auth_login_success / auth_login_failure', 'public'),
  'auth:isAccountsEnabled': readExempt(
    'Public pre-login probe; returns one boolean instance setting.',
    'public'
  ),
  'auth:logout': writeAuditedByHandler('auth_logout', 'viewer'),
  'auth:currentUser': readExempt(SELF_SESSION),
  'auth:changePassword': writeAuditedByHandler('auth_password_change', 'viewer'),
  'auth:listUsers': read('admin'),
  'auth:createUser': writeAuditedByHandler('api_write user_account (createUser)', 'admin'),
  'auth:setRole': writeAuditedByHandler('api_write user_account (setRole)', 'admin'),
  'auth:deactivateUser': writeAuditedByHandler('auth_user_deactivate', 'admin'),
  'auth:reactivateUser': writeAuditedByHandler('api_write user_account (reactivateUser)', 'admin'),
  'auth:resetPassword': writeAuditedByHandler('auth_password_reset', 'admin'),

  // ── audit trail ─────────────────────────────────────────────────────────
  // Entity history is clinical change history (shared data): every role.
  // The handler strips non-clinical entity types for non-admins.
  'audit:getByEntity': read('viewer'),
  'audit:query': read('admin'),

  // ── database / capabilities ─────────────────────────────────────────────
  'database:capabilities': readExempt(CAPABILITY),
  'system:getCapabilities': readExempt(CAPABILITY),
  'database:health': readExempt(CAPABILITY),
  'database:info': readExempt(CAPABILITY),
  'database:getOverview': readExempt('Aggregate counts for the overview page; no row data.'),

  // ── cases ───────────────────────────────────────────────────────────────
  'cases:list': read(),
  'cases:query': read(),
  'cases:availableBuilds': read(),
  'cases:delete': write('analyst'),
  'cases:startDelete': write('analyst'),
  'cases:deleteBatch': write('analyst'),
  'cases:deleteAll': write('admin'),

  // ── case metadata ───────────────────────────────────────────────────────
  'case-metadata:get': read(),
  'case-metadata:listCohorts': read(),
  'case-metadata:getCohortByName': read(),
  'case-metadata:getCaseCohorts': read(),
  'case-metadata:getHpoTerms': read(),
  'case-metadata:getDataInfo': read(),
  'case-metadata:listExternalIds': read(),
  'case-metadata:distinctHpoTerms': read(),
  'case-metadata:distinctPlatforms': read(),
  'case-metadata:distinctExternalIdTypes': read(),
  'case-metadata:getFullMetadata': read(),
  'case-metadata:upsert': write(),
  'case-metadata:createCohort': write(),
  'case-metadata:updateCohort': write(),
  'case-metadata:deleteCohort': write(),
  'case-metadata:assignCohort': write(),
  'case-metadata:removeCohort': write(),
  'case-metadata:setCohorts': write(),
  'case-metadata:assignHpoTerm': write(),
  'case-metadata:removeHpoTerm': write(),
  'case-metadata:upsertDataInfo': write(),
  'case-metadata:upsertExternalId': write(),
  'case-metadata:deleteExternalId': write(),

  // ── case comments / metrics ─────────────────────────────────────────────
  'case-comments:list': read(),
  'case-comments:create': write(),
  'case-comments:update': write(),
  'case-comments:delete': write(),
  'case-metrics:listDefinitions': read(),
  'case-metrics:listForCase': read(),
  'case-metrics:createDefinition': write(),
  'case-metrics:upsert': write(),
  'case-metrics:delete': write(),

  // ── variants ────────────────────────────────────────────────────────────
  'variants:typeCounts': read(),
  'variants:typesPresent': read(),
  'variants:geneSymbols': read(),
  'variants:search': read(),
  'variants:query': read(),
  'variants:getFilterOptions': read(),
  'variants:shortlist': read(),
  'variants:columnMeta': read(),

  // ── cohort ──────────────────────────────────────────────────────────────
  'cohort:getVariants': read(),
  'cohort:getSummary': read(),
  'cohort:getSummaryStatus': read(),
  'cohort:getColumnMeta': read(),
  'cohort:getCarriers': read(),
  'cohort:getGeneBurden': read(),
  'cohort:runAssociation': write(),
  'cohort:cancelAssociation': write(),

  // ── classification / annotations / tags ─────────────────────────────────
  'annotations:getGlobal': read(),
  'annotations:getPerCase': read(),
  'annotations:getForVariant': read(),
  'annotations:batchGet': read(),
  'annotations:upsertGlobal': write(),
  'annotations:deleteGlobal': write(),
  'annotations:upsertPerCase': write(),
  'annotations:deletePerCase': write(),
  'tags:list': read(),
  'tags:getUsageCount': read(),
  'tags:getVariantTags': read(),
  'tags:create': write(),
  'tags:update': write(),
  'tags:delete': write(),
  'tags:assignVariantTag': write(),
  'tags:removeVariantTag': write(),
  'tags:setVariantTags': write(),

  // ── export ──────────────────────────────────────────────────────────────
  'export:variants': read('analyst'),
  'export:cohort': read('analyst'),
  // Mints a single-use download grant; the artifact is audited when redeemed.
  'export:prepareDownload': read('analyst'),

  // ── import ──────────────────────────────────────────────────────────────
  'import:start': write(),
  'import:startMultiFile': write(),
  'import:cancel': write(),
  'import:vcfPreview': read('analyst'),
  'import:vcfMultiPreview': read('analyst'),
  'batch-import:start': write(),
  'batch-import:cancel': write(),
  'batch-import:extractZip': write(),
  'batch-import:cleanupZipTemp': write(),
  'batch-import:testZipPassword': read('analyst'),
  // Encrypted-entry probe on the caller's own uploaded ZIP (P-08).
  'batch-import:inspectZip': read('analyst'),
  'batch-import:checkDuplicates': read('analyst'),
  // Polled every 15 s for the whole batch; owner-checked in the run registry.
  'batch-import:status': readExempt(BATCH_POLL, 'analyst'),

  // ── jobs ────────────────────────────────────────────────────────────────
  'jobs:get': readExempt(POLL),
  'jobs:list': readExempt(POLL),
  'jobs:progress': readExempt(POLL),
  'jobs:cancel': write(),

  // ── panels / gene lists / region files / gene reference ─────────────────
  'panels:list': read(),
  'panels:get': read(),
  'panels:getGenes': read(),
  'panels:activeForCase': read(),
  'panels:resolutionStatus': read(),
  'panels:validateSymbols': read(),
  'panels:autocomplete': read(),
  'panels:create': write(),
  'panels:update': write(),
  'panels:delete': write(),
  'panels:duplicate': write(),
  'panels:setGenes': write(),
  'panels:activate': write(),
  'panels:deactivate': write(),
  'gene-lists:list': read(),
  'gene-lists:getGenes': read(),
  'gene-lists:create': write(),
  'gene-lists:delete': write(),
  'gene-lists:setGenes': write(),
  'region-files:list': read(),
  'region-files:create': write(),
  'region-files:delete': write(),
  'region-files:importBed': write(),
  'gene-ref:info': read(),
  'gene-ref:assemblies': read(),

  // ── presets / analysis groups / transcripts ─────────────────────────────
  'presets:list': read(),
  'presets:create': write(),
  'presets:update': write(),
  'presets:delete': write(),
  'presets:reorder': write(),
  'analysis-groups:list': read(),
  'analysis-groups:get': read(),
  'analysis-groups:getForCase': read(),
  'analysis-groups:create': write(),
  'analysis-groups:update': write(),
  'analysis-groups:delete': write(),
  'analysis-groups:addMember': write(),
  'analysis-groups:removeMember': write(),
  'transcripts:list': read(),
  'transcripts:switch': write(),
  'transcripts:insertAndSwitch': write(),

  // ── reference lookups (egress policy is configured per service by admins) ─
  'vep:fetch': read(),
  'vep:getCacheStats': readExempt('Cache size counters only.'),
  'vep:cancel': writeExempt(CANCEL_LOOKUP, 'viewer'),
  'vep:clearCache': write('admin'),
  'hpo:search': read(),
  'hpo:clearCache': write('admin'),
  'protein:getMapping': read(),
  'protein:getDomains': read(),
  'protein:getStructure': read(),
  'protein:getGeneStructure': read(),
  // P-C outbound lookups: refused unless an admin enabled the service; every
  // allowed or blocked call writes its own egress api_read row
  // (reference-services/audit-sink.ts), so the wrapper does not add one.
  'gnomad:getVariants': readAuditedByHandler(EGRESS_AUDIT, 'viewer'),
  'gnomad:getClinVarVariants': readAuditedByHandler(EGRESS_AUDIT, 'viewer'),
  'myvariant:fetch': readAuditedByHandler(EGRESS_AUDIT, 'viewer'),
  'myvariant:clearCache': write('admin'),
  'spliceai:fetch': readAuditedByHandler(EGRESS_AUDIT, 'viewer'),
  'spliceai:clearCache': write('admin'),
  'panels:searchPanelApp': readAuditedByHandler(EGRESS_AUDIT, 'viewer'),
  // Creating a panel from PanelApp / STRING is a curation write (analyst);
  // the lookup inside it is egress-audited separately.
  'panels:importPanelApp': write(),
  'panels:generateStringDb': write(),

  // ── external lookup (egress) policy ─────────────────────────────────────
  'reference-services:status': readExempt(CAPABILITY),
  'reference-services:setPolicy': writeAuditedByHandler(
    'api_write reference_services (policy change)',
    'admin'
  )
})

/** Non-dispatcher HTTP routes that also go through `secure()`. */
export const HTTP_ROUTE_SECURITY_MAP: Readonly<Record<string, OperationPolicy>> = Object.freeze({
  /** POST /api/import/upload — stages a file for import (audited by the route). */
  'http:import:upload': writeAuditedByHandler(
    'api_write import:upload (upload staging)',
    'analyst'
  ),
  /** GET /api/download/:token — redeems a grant and streams the artifact. */
  'http:export:download': readAuditedByHandler(
    'api_read export:variants | export:cohort | panels:exportBed',
    'analyst'
  ),
  /** GET /api/events — SSE change hints (ids only). */
  'http:events': readExempt('Server-sent change hints carry ids only, no clinical data.')
})

export function operationPolicy(key: string): OperationPolicy | undefined {
  return DISPATCHER_SECURITY_MAP[key] ?? HTTP_ROUTE_SECURITY_MAP[key]
}
