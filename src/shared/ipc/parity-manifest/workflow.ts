/**
 * Parity manifest slices for case workflow domains (metadata, comments,
 * metrics, transcripts, tags, lists, presets, analysis groups) and the
 * account / audit domains. See ../parity-manifest.ts for how to flip an entry.
 */
import {
  sharedExempt,
  sharedRead,
  sharedWrite,
  type DomainManifest
} from '../parity-manifest-types'

export const caseMetadataManifest = {
  get: sharedRead(),
  upsert: sharedWrite(),
  listCohorts: sharedRead(),
  createCohort: sharedWrite(),
  updateCohort: sharedWrite(),
  deleteCohort: sharedWrite(),
  getCohortByName: sharedRead(),
  getCaseCohorts: sharedRead(),
  assignCohort: sharedWrite(),
  removeCohort: sharedWrite(),
  setCohorts: sharedWrite(),
  getHpoTerms: sharedRead(),
  assignHpoTerm: sharedWrite(),
  removeHpoTerm: sharedWrite(),
  getDataInfo: sharedRead(),
  upsertDataInfo: sharedWrite(),
  listExternalIds: sharedRead(),
  upsertExternalId: sharedWrite(),
  deleteExternalId: sharedWrite(),
  distinctHpoTerms: sharedRead(),
  distinctPlatforms: sharedRead(),
  distinctExternalIdTypes: sharedRead(),
  getFullMetadata: sharedRead()
} satisfies DomainManifest<'caseMetadata'>

export const caseCommentsManifest = {
  list: sharedRead(),
  create: sharedWrite(),
  update: sharedWrite(),
  delete: sharedWrite()
} satisfies DomainManifest<'caseComments'>

export const caseMetricsManifest = {
  listDefinitions: sharedRead(),
  createDefinition: sharedWrite(),
  listForCase: sharedRead(),
  upsert: sharedWrite(),
  delete: sharedWrite()
} satisfies DomainManifest<'caseMetrics'>

export const transcriptsManifest = {
  list: sharedRead(),
  switch: sharedWrite(),
  insertAndSwitch: sharedWrite()
} satisfies DomainManifest<'transcripts'>

export const tagsManifest = {
  list: sharedRead(),
  create: sharedWrite(),
  update: sharedWrite(),
  delete: sharedWrite(),
  getUsageCount: sharedRead(),
  getVariantTags: sharedRead(),
  assignVariantTag: sharedWrite(),
  removeVariantTag: sharedWrite(),
  setVariantTags: sharedWrite()
} satisfies DomainManifest<'tags'>

export const geneListsManifest = {
  list: sharedRead(),
  create: sharedWrite(),
  delete: sharedWrite(),
  getGenes: sharedRead(),
  setGenes: sharedWrite()
} satisfies DomainManifest<'geneLists'>

export const regionFilesManifest = {
  list: sharedRead(),
  create: sharedWrite(),
  delete: sharedWrite(),
  importBed: sharedWrite()
} satisfies DomainManifest<'regionFiles'>

export const presetsManifest = {
  list: sharedRead(),
  create: sharedWrite(),
  update: sharedWrite(),
  delete: sharedWrite(),
  reorder: sharedWrite()
} satisfies DomainManifest<'presets'>

export const analysisGroupsManifest = {
  list: sharedRead(),
  get: sharedRead(),
  create: sharedWrite(),
  update: sharedWrite(),
  delete: sharedWrite(),
  addMember: sharedWrite(),
  removeMember: sharedWrite(),
  getForCase: sharedRead()
} satisfies DomainManifest<'analysisGroups'>

/**
 * Activity log: non-admins get the entity's clinical change history (writes),
 * admins also see access reads. The full trail query is admin-only.
 */
export const auditManifest = {
  getByEntity: sharedRead(),
  query: sharedRead({ authz: 'admin', capability: 'auditTrail' })
} satisfies DomainManifest<'audit'>

const AUTH_SERVICE_AUDIT = 'the auth service writes its own user_account audit rows'
const SESSION_PLUMBING = 'session plumbing, audited as login/logout events'

export const authManifest = {
  login: sharedExempt(SESSION_PLUMBING, { authz: 'public' }),
  logout: sharedExempt(SESSION_PLUMBING),
  currentUser: sharedExempt(SESSION_PLUMBING),
  isAccountsEnabled: sharedExempt(SESSION_PLUMBING, { authz: 'public' }),
  createUser: sharedExempt(AUTH_SERVICE_AUDIT, { authz: 'admin', capability: 'userAdmin' }),
  listUsers: sharedRead({ authz: 'admin', capability: 'userAdmin' }),
  deactivateUser: sharedExempt(AUTH_SERVICE_AUDIT, { authz: 'admin', capability: 'userAdmin' }),
  reactivateUser: sharedExempt(AUTH_SERVICE_AUDIT, { authz: 'admin', capability: 'userAdmin' }),
  setRole: sharedExempt(AUTH_SERVICE_AUDIT, { authz: 'admin', capability: 'userAdmin' }),
  resetPassword: sharedExempt(AUTH_SERVICE_AUDIT, { authz: 'admin', capability: 'userAdmin' }),
  changePassword: sharedExempt(AUTH_SERVICE_AUDIT)
} satisfies DomainManifest<'auth'>
