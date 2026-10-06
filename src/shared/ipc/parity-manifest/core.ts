/**
 * Parity manifest slices for the core shell domains (cases, variants, import,
 * export, database, cohort, annotations and the desktop runtime services).
 * See ../parity-manifest.ts for the rules and how to flip an entry.
 */
import {
  adapter,
  desktopOnly,
  sharedExempt,
  sharedRead,
  sharedWrite,
  type DomainManifest
} from '../parity-manifest-types'

const DB_FILES_UX = 'Hidden: the web version has one server-configured workspace (DatabasePicker).'
const ENCRYPTION_UX = 'Hidden: encryption at rest is the server operator concern (disk / PG TDE).'
const PG_PROFILE_UX = 'Hidden: the server owns its PostgreSQL connection (VARLENS_PG_URL).'

export const casesManifest = {
  list: sharedRead(),
  query: sharedRead(),
  delete: sharedWrite(),
  // Web: deleting every case is admin-only (startDelete mode 'all' is checked server-side).
  deleteAll: sharedWrite({ authz: 'admin' }),
  deleteBatch: sharedWrite(),
  startDelete: sharedWrite(),
  availableBuilds: sharedRead()
} satisfies DomainManifest<'cases'>

export const variantsManifest = {
  query: sharedRead(),
  getFilterOptions: sharedRead(),
  search: sharedRead(),
  geneSymbols: sharedRead(),
  typeCounts: sharedRead(),
  columnMeta: sharedRead(),
  typesPresent: sharedRead(),
  shortlist: sharedRead(),
  onAnnotationChanged: adapter('sse')
} satisfies DomainManifest<'variants'>

export const importManifest = {
  onProgress: adapter('sse'),
  selectFile: adapter('upload', { authz: 'analyst' }),
  selectFiles: adapter('upload', { authz: 'analyst' }),
  selectBedFile: adapter('upload', { authz: 'analyst' }),
  enrollDroppedFiles: adapter('upload', { authz: 'analyst' }),
  start: sharedWrite(),
  startMultiFile: sharedWrite({ capability: 'multiFileImport' }),
  vcfPreview: sharedRead({ authz: 'analyst' }),
  vcfMultiPreview: sharedRead({
    authz: 'analyst',
    degraded: { tracking: 'P-B (PR-W9a)', note: 'sibling BED discovery is empty for uploads' }
  }),
  // Role >= analyst (security map) AND owner-checked (WebJobRegistry):
  // 403 for another user's import unless the caller is an admin.
  cancel: sharedWrite()
} satisfies DomainManifest<'import'>

export const systemManifest = {
  getVersion: adapter('client'),
  getUserDataPath: desktopOnly('desktopDiagnostics', 'Hidden: no user data folder in web.'),
  getCpuCount: desktopOnly(
    'workerThreads',
    'Hidden: browser CPU count is irrelevant to the server.'
  ),
  setWorkerThreads: desktopOnly('workerThreads', 'Hidden: import concurrency is operator config.'),
  getWorkerThreads: desktopOnly('workerThreads', 'Hidden: import concurrency is operator config.'),
  getLogFilePath: desktopOnly('desktopDiagnostics', 'Hidden: server logs go to the operator.'),
  getCapabilities: sharedExempt('capability document is read on every page load')
} satisfies DomainManifest<'system'>

export const exportManifest = {
  variants: adapter('download', { authz: 'analyst' }),
  cohort: adapter('download', { authz: 'analyst' }),
  revealInFolder: desktopOnly('revealInFolder', 'Hidden: the browser download replaces it.'),
  cancel: adapter('client'),
  onProgress: adapter('sse')
} satisfies DomainManifest<'export'>

export const shellManifest = {
  openExternal: adapter('client'),
  updateDomains: adapter('client')
} satisfies DomainManifest<'shell'>

export const databaseManifest = {
  selectFile: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  selectSaveLocation: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  open: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  create: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  rekey: desktopOnly('databaseEncryption', ENCRYPTION_UX),
  migrateToEncrypted: desktopOnly('databaseEncryption', ENCRYPTION_UX),
  deletePlaintextBackup: desktopOnly('databaseEncryption', ENCRYPTION_UX),
  setRecoveryPassphrase: desktopOnly('databaseEncryption', ENCRYPTION_UX),
  info: sharedExempt('workspace identity, no clinical data'),
  capabilities: sharedExempt('backend capability flags, no clinical data'),
  postgresDiagnostics: desktopOnly('postgresProfiles', PG_PROFILE_UX),
  postgresProfilesList: desktopOnly('postgresProfiles', PG_PROFILE_UX),
  postgresProfileSave: desktopOnly('postgresProfiles', PG_PROFILE_UX),
  postgresProfileRemove: desktopOnly('postgresProfiles', PG_PROFILE_UX),
  postgresProfileTest: desktopOnly('postgresProfiles', PG_PROFILE_UX),
  postgresProfileOpen: desktopOnly('postgresProfiles', PG_PROFILE_UX),
  recentList: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  getOverview: sharedExempt('aggregate counts, read on every settings open'),
  removeRecent: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  deleteFile: desktopOnly('localDatabaseFiles', DB_FILES_UX),
  showInFolder: desktopOnly('localDatabaseFiles', DB_FILES_UX)
} satisfies DomainManifest<'database'>

export const batchImportManifest = {
  selectFiles: adapter('upload', { authz: 'analyst' }),
  selectFolder: adapter('upload', { authz: 'analyst' }),
  checkDuplicates: sharedRead({ authz: 'analyst' }),
  start: sharedWrite(),
  // Role >= analyst AND owner-checked, like import.cancel.
  cancel: sharedWrite(),
  onProgress: adapter('sse'),
  onComplete: adapter('sse'),
  selectZip: adapter('upload', { authz: 'analyst' }),
  testZipPassword: sharedRead({ authz: 'analyst' }),
  extractZip: sharedWrite(),
  cleanupZipTemp: sharedWrite()
} satisfies DomainManifest<'batchImport'>

export const cohortManifest = {
  getVariants: sharedRead(),
  getSummary: sharedRead(),
  getCarriers: sharedRead(),
  getGeneBurden: sharedRead(),
  getColumnMeta: sharedRead(),
  getSummaryStatus: sharedRead(),
  rebuildSummary: desktopOnly(
    'cohortSummaryRebuild',
    'Hidden: the Postgres cohort summary is computed live.'
  ),
  onSummaryRebuilt: adapter('sse'),
  // Postgres association runs per user on the web server (PR-W13).
  runAssociation: sharedWrite({ capability: 'cohortAssociation' }),
  cancelAssociation: sharedWrite({ capability: 'cohortAssociation' }),
  onAssociationProgress: adapter('sse', { capability: 'cohortAssociation' })
} satisfies DomainManifest<'cohort'>

export const annotationsManifest = {
  getGlobal: sharedRead(),
  upsertGlobal: sharedWrite(),
  deleteGlobal: sharedWrite(),
  getPerCase: sharedRead(),
  upsertPerCase: sharedWrite(),
  deletePerCase: sharedWrite(),
  getForVariant: sharedRead(),
  batchGet: sharedRead()
} satisfies DomainManifest<'annotations'>

export const logsManifest = {
  onMessage: desktopOnly('mainProcessLogs', 'Client-side logs only in web.')
} satisfies DomainManifest<'logs'>

const UPDATER_UX = 'Hidden: the deployment updates the web version.'

export const updaterManifest = {
  checkForUpdate: desktopOnly('autoUpdate', UPDATER_UX),
  downloadUpdate: desktopOnly('autoUpdate', UPDATER_UX),
  installUpdate: desktopOnly('autoUpdate', UPDATER_UX),
  getStatus: desktopOnly('autoUpdate', UPDATER_UX),
  onStatusChange: desktopOnly('autoUpdate', UPDATER_UX)
} satisfies DomainManifest<'updater'>

export const perfManifest = {
  reportInteractive: adapter('client'),
  getSnapshot: desktopOnly('desktopDiagnostics', 'Desktop E2E perf harness only.'),
  resetSnapshot: desktopOnly('desktopDiagnostics', 'Desktop E2E perf harness only.'),
  isEnabled: adapter('client')
} satisfies DomainManifest<'perf'>

export const debugManifest = {
  queryCountersGet: desktopOnly('desktopDiagnostics', 'Web uses /metrics.'),
  queryCountersReset: desktopOnly('desktopDiagnostics', 'Web uses /metrics.')
} satisfies DomainManifest<'debug'>

export const jobsManifest = {
  list: sharedExempt('job polling is excluded from the read audit'),
  get: sharedExempt('job polling is excluded from the read audit'),
  progress: sharedExempt('job polling is excluded from the read audit'),
  cancel: sharedWrite(),
  onChanged: adapter('sse')
} satisfies DomainManifest<'jobs'>
