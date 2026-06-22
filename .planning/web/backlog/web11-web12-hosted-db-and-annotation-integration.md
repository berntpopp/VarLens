# Web 11 / Web 12 — hosted DB foundation and annotation integration

Status: backlog / not current execution
Created: 2026-06-22

## Why This Exists

The web track now needs two separate steps:

1. **Web 11** prepares hosted-mode storage for high-sensitivity genomic data.
2. **Web 12** imports annotation workflow bundles through a VarLens-owned adapter.

Keep these separate. The database boundary must be settled before the annotation
bundle importer decides where raw evidence, promoted fields, public snapshot
references, and audit records live.

This is web-only planning. The Electron desktop app and encrypted local SQLite
database stay unchanged.

## Current Boundary

VarLens owns:

- the web runtime contract
- storage abstractions and migrations used by the app
- bundle import and reannotation orchestration
- first-class annotation mapping
- raw/provenance storage in the private workspace database
- audit events emitted by app behavior
- tests proving desktop behavior is not coupled to hosted web config

Deployment/operator repositories own:

- concrete PostgreSQL clusters/databases
- roles, grants, secrets, pooling, and network policy
- backup/restore implementation
- Kubernetes, Helm, Argo CD, release pins, and runbooks

The annotation workflow repository owns:

- bundle production
- manifest and checksum contract
- snapshot build metadata
- validator fixtures

It must not write directly into VarLens databases.

## Web 11 — Hosted DB Foundation

Detailed app contract: `web11-hosted-db-foundation-contract.md`.

### Target Behavior

Hosted web mode uses three data boundaries:

| Boundary | Purpose |
| --- | --- |
| Control DB | workspace registry, routing metadata, provisioning/migration state |
| Private workspace DB | cases, variants, genotypes, raw evidence, user annotations, imports, exports, private audit |
| Public annotation boundary | immutable, released, license-cleared annotation snapshots; runtime is read-only only if live DB lookup is selected |

This replaces schema-per-project as the target model for hosted sensitive
genomics deployments. Schema-per-project may still exist for legacy,
developer, or single-instance paths if explicitly accepted, but it is not the
target safety boundary for hosted sensitive workspaces.

### Order Of Work

1. **Runtime contract.** Define config names, connection classes, and boot
   behavior for control DB and workspace DB routing. Public annotation runtime
   wiring is absent unless a live read strategy is selected; otherwise Web 11
   only records the strategy decision gate for Web 12.
2. **Storage boundary.** Keep private case writes inside exactly one private
   workspace database. Do not introduce cross-database writes without an
   explicit outbox/retry contract.
3. **Workspace authorization.** Verify the authenticated session and workspace
   membership/role before resolving any private workspace DB connection.
4. **Public annotation strategy.** Select or explicitly block the access strategy
   before Web 12 adapter work. Add app-side read-only public DB access only when
   live lookup is selected. Offline/materialized snapshot designs must not be
   forced into a runtime public DB URL. Runtime code must not require publisher,
   migrator, owner, or superuser privileges.
5. **Desktop guardrail.** Desktop SQLite must start and import without any
   control/public DB configuration.
6. **Test strategy.** Add negative tests for app behavior and define which
   checks belong to deployment/operator integration tests.

### App-Level Acceptance Checks

- Desktop SQLite starts without hosted web DB variables.
- Web mode refuses invalid or incomplete hosted DB configuration clearly.
- Hosted mode refuses unauthenticated or non-member workspace requests before
  resolving private DB credentials.
- App code never writes private case data to the public annotation DB.
- App tests cover routing failure behavior without real platform-admin grants.
- Logs and errors do not serialize VCF lines, genotypes, sample IDs, private
  variant batches, local paths, or public-DB lookup batches.
- Runtime role expectations are documented for deployment/operator tests:
  public DB read-only, one private workspace DB per workspace route, and no
  migration/admin privileges in request runtime.

### Out Of Scope

- Annotation bundle mapping.
- Public snapshot schema population.
- Cross-workspace analytics.
- OIDC implementation changes.
- Desktop SQLite migration.
- Kubernetes, Helm, CloudNativePG, PgBouncer, backup, or restore
  implementation.

## Web 12 — Annotation Bundle Integration

### Target Behavior

VarLens imports annotation workflow output through a VarLens-owned adapter. The
annotation workflow repository produces files and manifests; VarLens decides how
to map, store, audit, and expose them.

Expected bundle families:

- SNP/indel VCFs
- SV VCFs
- CNV VCFs
- STR VCFs
- AnnotSV TSV sidecars
- Straglr TSV sidecars
- report and manifest files

The bundle is private case data unless a field is explicitly classified as
license-cleared public reference data.

The Web 12 handoff is not just "read a folder." It needs a versioned bundle
contract with paths, required versus optional files, indexes, checksums,
sample/run identifiers, genome build, tool/resource versions, schema version,
import ordering, and failure semantics.

### Order Of Work

1. **Bundle contract reader.** Parse manifest, file inventory, checksums,
   genome build, tool versions, source metadata, required/optional files, and
   import ordering.
2. **File validation.** Fail before import when required files, indexes,
   checksums, genome build, or variant type declarations are inconsistent.
3. **Variant identity.** Normalize SNV/indel, SV/CNV, and STR identity using
   explicit matching rules. STRs must not be forced into a `chr,pos,ref,alt`
   identity model when a locus/repeat-catalog key is required.
4. **Promoted mapping.** Materialize only fields needed for filtering, sorting,
   display, and review as first-class columns/tables.
5. **Raw evidence.** Preserve raw VCF INFO/CSQ/ANN and TSV sidecar values with
   provenance in the private workspace DB.
6. **Public snapshot reference.** Store the public annotation snapshot ID,
   field contract version, and mapping version used for each import or
   reannotation job.
7. **Import report.** Record counts, skipped records, withheld fields,
   mapping warnings, and sidecar join failures.
8. **Reannotation.** Treat reannotation as an explicit job that produces a diff.
   New public snapshots must not silently rewrite old case interpretations.

Before implementation, Web 12 must define:

- STR VCF plus Straglr TSV preservation and linking rules
- AnnotSV TSV required columns, join strategy, transcript/source context,
  dosage fields, optional-layer presence, and null semantics
- promoted versus raw/provenance rules for caller INFO, sanitized evidence,
  VEP/ANN/CSQ, AnnotSV, Straglr, and source columns
- license/storage class per promoted field, with explicit withheld markers for
  restricted or unknown-license values

### First-Class Versus Raw

Promote only stable, queryable values that VarLens needs directly:

- canonical variant identity
- gene/transcript/consequence summary
- clinically meaningful classification summaries
- population-frequency fields selected by the mapping contract
- selected score fields only after license review
- snapshot and mapping provenance

Keep everything else raw/provenance-led until a specific UI, filter, or clinical
workflow needs it.

### App-Level Acceptance Checks

- Valid fixture bundle imports into a private workspace DB.
- Invalid manifest/checksum/genome-build fixtures fail before writes.
- Same input plus same snapshot plus same mapping version is deterministic.
- Public annotation DB receives no private case, sample, genotype, or user data.
- Restricted or unknown-license fields are withheld explicitly rather than
  silently dropped.
- AnnotSV and Straglr sidecars are retained with provenance even when only a
  subset is promoted.
- Import report is available after success and failure.
- Desktop import paths still run without hosted web DB configuration.

### Out Of Scope

- Direct annotation workflow writes into VarLens databases.
- Mutable `latest` public annotation semantics.
- Silent reannotation of existing cases.
- Global cross-workspace cohort analytics.
- External live annotation API calls as the v1 path.

## Shared Risks

- **License overclaim.** Public data source availability does not mean VarLens
  can redistribute or materialize every derived field in a shared public DB.
- **Query leakage.** Public DB lookups can reveal private variant intent through
  logs, traces, metrics, or access patterns.
- **Cross-database consistency.** PostgreSQL has no direct cross-database
  transaction boundary. Multi-DB workflows need retryable state or must stay
  read-only across boundaries.
- **Connection pressure.** One DB per workspace changes pooling and readiness
  assumptions. The app contract must not imply one eager pool per workspace.
- **Desktop drift.** Hosted web requirements must not leak into desktop startup,
  packaging, or local SQLite import behavior.

## Exit Criteria

Web 11 exits when the app contract and tests are good enough for an operator
repository to implement the topology without guessing app behavior.

Web 12 exits when a representative annotation bundle can be imported through
the VarLens adapter into a private workspace DB, with public snapshot
references, provenance, import report, and deterministic reannotation behavior.
