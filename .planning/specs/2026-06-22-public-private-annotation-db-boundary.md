# Public/Private Annotation Database Boundary - ADR and Planning Spec

**Status:** Draft 2026-06-22
**Scope:** Planning only; no implementation in this document.
**Motivation:** VarLens hosted/web work for high-sensitivity genomics data, annotation-bundle import, and public annotation snapshot reuse.

## Summary

VarLens should treat sensitive case-level genomics data and reusable public annotation snapshots as different data classes with different persistence boundaries.

The proposed hosted topology is:

1. **Control DB** for workspace registry, provisioning state, migration state, and routing metadata.
2. **Private workspace DBs**: one PostgreSQL database per workspace/tenant/project for sensitive cases, variants, genotypes, raw VCF/CSQ/ANN evidence, user annotations, tags, comments, ACMG evidence, imports, and private audit.
3. **Public annotation DB**: one deployment-internal, app-read-only PostgreSQL database for immutable, released, license-cleared public annotation snapshots.

This is a **web/hosted-mode** architecture decision. The desktop SQLite application remains outside this track and must keep its current local/offline behavior unless a separate desktop planning document explicitly opts into a change.

The concrete deployed database topology is owned by the deployment/operator layer. VarLens owns the application contract, data model, import/reannotation behavior, runtime connection expectations, and tests that prove the app does not need platform-admin privileges.

This is a deliberate course correction from earlier schema-per-project planning. It trades cross-project SQL convenience for stronger physical boundaries around high-sensitivity genomic workspaces.

The design supports data-minimization and simpler authorization boundaries. It does **not** make genomic data anonymous, remove compliance obligations, make audit trivial, or make public annotation access risk-free.

## Existing Planning Conflicts

This ADR must be resolved before implementing annotation-bundle import or public snapshot infrastructure because it changes assumptions in existing planning material.

- `.planning/specs/2026-05-28-multi-project-architecture.md` plans PostgreSQL schema-per-project inside one database, shared pools, and PG-only cross-project `UNION ALL`. That model is not the target boundary for hosted sensitive genomics data.
- `.planning/specs/2026-06-10-audit-schema-isolation.md` correctly relies on same-database transactions for audit writes. Under DB-per-workspace, private audit remains same-DB with the private write, but cross-DB registry/public operations require reconciliation/outbox semantics instead of atomic cross-DB transactions.
- Current web/Postgres configuration is `VARLENS_PG_URL` + `VARLENS_PG_SCHEMA`. This must evolve into an explicit control/private/public topology; a single schema setting is not enough.
- Existing WGS import/query performance baselines were captured against a simpler Postgres model. DB-per-workspace, multiple pools, PgBouncer, and public snapshot lookup/materialization require re-baselining before performance claims.
- Current web/Postgres deployment uses a single application database URL. Any real hosted topology change must therefore publish an app contract that deployment repositories can consume, not an implementation that hard-codes one operator's infrastructure.

Decision to make in this ADR series: schema-per-project remains acceptable only as a legacy/developer/single-instance mode, or it is superseded for hosted sensitive deployments by DB-per-workspace.

## In Scope

- Hosted/web PostgreSQL topology for sensitive genomics workspaces.
- Repository ownership boundaries between VarLens, deployment/operator repositories, charting, and the annotation workflow repository.
- Public/private data classification and hard boundary rules.
- Public annotation snapshot license/provenance gates.
- Runtime role boundaries for private DBs and public annotation DB.
- Migration/provisioning planning for N private databases plus one public annotation database.
- Audit, logging, backup/restore, and operational gates needed before implementation PRs.
- Impact on future annotation-bundle import and reannotation planning.

## Non-Goals

- No code, migrations, schemas, or docs-site edits in this planning PR.
- No change to the desktop SQLite single-file model.
- No requirement that desktop mode knows about the control DB, public annotation DB, workspace provisioning, Kubernetes, CloudNativePG, or platform release wiring.
- No real-time global cross-tenant analytics or warehouse.
- No external live annotation API as the v1 path.
- No mutable "current" annotation database that silently changes old case interpretations.
- No app-runtime write access to the public annotation DB.
- No claim of legal compliance, anonymization, or reduced statutory obligations.
- No two-phase commit requirement across control/private/public databases.

## Repository Boundary

This plan must stay explicit about which repository owns which decisions. Otherwise the implementation will either duplicate platform concerns inside VarLens or accidentally change desktop behavior while solving hosted web isolation.

### VarLens source repository

VarLens owns the application behavior and contracts:

- web/hosted-mode connection contract: control DB, private workspace DB, public annotation DB, and role expectations;
- storage abstractions, migration compatibility checks, import/reannotation orchestration, and audit event semantics;
- private materialization model for promoted annotation values and raw evidence;
- API behavior, health/readiness semantics, and tests that prove the runtime never needs platform-admin privileges;
- desktop guardrails: SQLite/local mode remains the default desktop path and must not require platform configuration.

VarLens should not own Kubernetes cluster objects, CloudNativePG cluster sizing, platform namespaces, release pins, production secrets, backup policies, or operator runbooks beyond documenting the contract it needs.

### Deployment/operator repository

The deployment/operator repository owns the deployed web topology:

- CloudNativePG clusters/databases/roles/secrets for control, private workspace, and public annotation databases;
- Kubernetes namespaces, Helm values, Argo CD wiring, image release pins, and environment-specific deployment choices;
- PgBouncer or other pooling layer, connection budgets, network policy, service discovery, and health monitoring;
- platform jobs for audit owner/provisioning, retention, backups, restores, and break-glass operational access;
- dev/test/prod differences, including disposable E2E stacks and persistent test/prod data handling.

Operator changes should be driven by the VarLens application contract, but the actual resource definitions and operator workflows belong outside this repository.

### VarLens Helm chart / clinical app chart

The chart is the boundary between app contract and platform deployment. It should expose values for the hosted web topology without hard-coding one lab's policy into VarLens code:

- enable/disable hosted web database topology;
- connection secret names for control/public/workspace routing or a provisioner service;
- runtime role secret references, migration job hooks, readiness probes, and pooling options;
- chart defaults that keep simple dev/test deployment possible without changing desktop code.

### Annotation workflow repository

The annotation repository owns bundle/snapshot production contracts:

- bundle manifest, file inventory, checksums, and validation;
- public snapshot build manifests and license/provenance evidence;
- fixtures that VarLens can use to verify mapping behavior.

It should not own VarLens private DB schema, workspace provisioning, user audit semantics, or platform deployment.

## Data Classes

Every new table, volume, export, log stream, and backup must declare one of these classes before implementation.

| Class | Examples | Boundary |
| --- | --- | --- |
| `case_data` | variants, genotypes, samples, raw VCF/CSQ/ANN, STR/AnnotSV sidecars, import manifests/reports, phenotype context | Private workspace DB or private object store only |
| `clinical_annotations` | ACMG classifications, comments, tags, stars, curated case evidence, user interpretation | Private workspace DB only |
| `public_reference_annotations` | license-cleared ClinVar/gnomAD/ClinGen/GenCC-style snapshot rows, source metadata, field contracts | Public annotation DB only after release gates |
| `audit_events` | auth, import/export, reannotation, snapshot application, admin/break-glass, restore, publish events | Private DB for private actions; Control DB audit may contain controlled operational identifiers such as user/workspace IDs but no case/genomic/clinical payloads; public DB audit contains no private identifiers |
| `technical_logs` | health checks, pool metrics, service errors after redaction | Never contain variants, genotypes, samples, clinical text, or private query batches |
| `auth_material` | session tokens, credential files, secret references, bootstrap secrets, API tokens | Never public; never in logs, metrics, traces, errors, manifests, or public snapshots |

Annotation bundles are `case_data` until proven otherwise. A public GitHub repository, public download URL, or public research dataset is not sufficient to classify derived artifacts as public-reference data.

## Public/Private Boundary Rules

Public annotation DB may contain only patient-independent, license-cleared, versioned reference annotation snapshots. It must not contain:

- sample IDs, case IDs, user IDs, workspace IDs, patient names, local paths, access tokens;
- genotypes, zygosity, read depth, VAF, case-linked HPO context, phenotype text, pedigree data;
- user comments, stars, tags, ACMG classifications, ACMG evidence, shortlist decisions;
- query history, private variant batches, private allele observations, private cohort frequencies;
- private or institution-derived aggregates unless a separate release process explicitly classifies them as public-reference data.

Every private-to-public transition must be a publish process with privacy, license, provenance, and audit gates. The default direction is **Public -> Private**. Reannotation never writes private data back to public snapshots.

## Target DB Topology

### Control DB

The control DB owns registry and operational state, not case data.

Expected content:

- workspace registry and immutable workspace IDs;
- private DB connection references, redacted labels, state, current migration target;
- provisioning lifecycle: `requested`, `creating`, `migrating`, `active`, `failed`, `quarantined`, `deprovisioning`, `deleted`;
- migration orchestration state per workspace DB;
- pool/routing metadata and health summaries;
- no variants, genotypes, samples, comments, ACMG evidence, or private annotation values.

The control DB must not store plaintext private workspace DB passwords. It may
store secret references, database names, role names, and non-secret routing
metadata. In Web 11 v1, actual credentials are resolved from operator-mounted
credential files addressed by those non-secret references. Other platform
resolver APIs are future work.

Control DB user, session, membership, selected-workspace, and access-audit state
is access-controlled operational/audit data. It can reveal user-workspace access
patterns even without genomic payloads, so backups, logs, metrics, and retention
must have an owner and access policy.

Risk: if every request depends on a control DB lookup, the control DB becomes a runtime SPOF. Implementation planning must decide between cached routing with TTL/invalidation or explicitly accepting the SPOF.

### Private Workspace DB

The private workspace DB is the only persistent home for sensitive workspace data.

Expected content:

- cases, variants, genotypes, raw VCF INFO including `CSQ`/`ANN`, per-allele/per-transcript raw evidence;
- sidecar raw evidence and join reports;
- user annotations, comments, tags, panels, ACMG evidence/classifications, imports, exports;
- private audit events in the same DB transaction as private writes;
- pinned public snapshot references and materialized promoted evidence needed for reproducibility and filtering.

Private audit remains same-DB and transactional with the change it records. Central audit aggregation, if needed later, is asynchronous WORM/export and not the authoritative transaction boundary.

### Public Annotation DB

The public annotation DB is an immutable snapshot catalog, not a live mutable knowledge base.

Expected content:

- released snapshot metadata and source manifests;
- normalized public-reference annotation rows only when license-cleared;
- field contracts with data type, source, null semantics, storage class, and public/private classification;
- activation/deprecation/revocation metadata;
- public-publish audit events without private IDs.

The app runtime role has SELECT only. Public snapshot publication uses a separate publisher/migration role through staging -> validation -> activation. Corrections create a new snapshot; released rows are not updated in place.

## Roles and Privileges

Minimum role families to plan:

- `control_app_ro`: request-time read of workspace registry, membership, routing state, and migration compatibility; no private data access, no createdb/role ownership.
- `control_app_state`: narrowly scoped request-time writes for sessions, access audit, and selected workspace state where needed; no workspace provisioning or private data access.
- `workspace_provisioner`: creates/drops/quarantines workspace DBs after an
  operator/IAC CLI request; not used by normal runtime requests and not mounted
  into the VarLens request-serving container.
- `workspace_app_rw`: runtime DML for exactly one private workspace DB.
- `workspace_migrator`: DDL/migrations for private workspace DBs; not used by request runtime.
- `workspace_backup`: backup/restore credential with audited operational access.
- `public_annotation_ro`: runtime SELECT only on released public snapshots.
- `public_annotation_publisher`: staging and release of public snapshots; not held by app runtime.
- `public_annotation_migrator`: DDL/migrations for public annotation DB.
- `monitor`: health/metrics access with no `case_data` SELECT.
- `break_glass`: exceptional, time-boxed, heavily audited operational access.

Runtime app credentials must not have superuser, owner, role management, CREATEDB, public write, or migration privileges. Web 11 v1 uses per-workspace roles/credentials; any later shared private DB role would need a new ADR that explicitly accepts the routing-bug blast radius.

Workspace provisioning is operator-triggered from the deployment/IAC control
plane, not from a VarLens web admin endpoint. VarLens owns the app semantics of
the created user/workspace, password policy, roles, and `must_change_password`;
the deployment/operator provisioner owns physical databases, role grants,
credential writing, and one-shot Kubernetes Jobs.

## Cross-DB Decisions

PostgreSQL does not support direct cross-database joins. The first implementation plan must choose explicit mechanisms for both cross-workspace behavior and public annotation use.

### Cross-workspace queries

DB-per-workspace breaks the previous schema-based `UNION ALL` plan. Choices:

- app-level fan-out and merge;
- separate aggregate/warehouse built from explicit exports;
- no cross-workspace query support in v1.

No implementation may assume SQL joins across private workspace DBs.

### Public annotation lookup/materialization

Private variants and public annotation snapshots live in different databases. Choices:

- app-side lookup and materialization into the private DB;
- `postgres_fdw` read-only linkage;
- replicate the required released public annotation subset into the private DB;
- precompute snapshot bundles outside request-time queries.

Security review currently prefers download/materialization over ad-hoc public service lookups, because query parameters and access patterns can leak private case intent. If `postgres_fdw` or live app-side lookup is chosen, the plan must address query logging, parameter leakage, pool behavior, and failure modes.

Until this decision is closed, the Web 11 app contract must not make a live
public annotation database URL mandatory. A runtime public DB connection is only
required if live lookup is the selected strategy.

## Public Snapshot License Matrix

Public snapshot eligibility is fail-closed. Unknown licensing blocks public release.

The source-license matrix must be machine-readable and field-aware. Required fields:

- `source_id`, exact version/release date, source URL/accession;
- `license_id` or controlled local license code, `license_url`, archived license text hash;
- redistribution class: `public_redistributable`, `attribution_public`, `metadata_only`, `private_escrow`, `compute_only`, `restricted`, `prohibited`;
- commercial/clinical use: `allowed`, `separate_license`, `noncommercial_only`, `unknown`;
- attribution text/citation;
- derivative inheritance/share-alike flags;
- field-level storage class and promotion eligibility;
- reviewer, review date, and evidence.

Initial default blocklist for public snapshots until field-level clearance exists:

- dbNSFP and dbNSFP-derived sub-scores;
- OMIM content;
- SpliceAI precomputed scores;
- CADD scores;
- AlphaMissense scores/predictions;
- PanelApp, Orphanet, DECIPHER;
- AnnotSV TSV output as a whole, because it inherits mixed input-source restrictions.

Likely candidates for public snapshots after explicit review include ClinVar, gnomAD summary data, ClinGen curated content, and GenCC, but still require pinned release metadata, attribution, and license evidence.

## Public Snapshot Metadata

Every released snapshot must carry:

- `snapshot_id` derived from immutable content hash over data, source manifests, license set, field contract, and transform versions;
- semantic version, release date, build date, status: `draft`, `released`, `deprecated`, `revoked`;
- `genome_build`, patch level, contig naming, reference FASTA checksum;
- transcript/reference context: VEP/Ensembl cache, GENCODE, RefSeq, MANE, transcript-selection policy;
- toolchain manifest: workflow git SHA, container digests, tool/plugin versions, parameters;
- source manifest per source: raw checksum, normalized checksum, retrieval timestamp, license class;
- field contract: field name, source, type, units, null semantics, normalization, public/private storage class;
- derivation graph: raw artifact hash -> transform hash -> normalized table hash;
- compatibility: minimum VarLens schema/importer/adapter version;
- diff metadata: superseded snapshot, added/removed/changed row counts, high-impact changes, known caveats;
- attribution bundle.

Snapshot identity never points to `latest`. Private workspace records pin `snapshot_id + field_contract_version + mapping_version`.

## Variant Identity and Matching

Identity is part of the contract and part of the snapshot hash.

- SNV/indel: normalized `(assembly, contig, pos, ref, alt)` with explicit reference, left-alignment, trimming policy, and multi-allelic handling.
- SV/CNV: explicit model for `SVTYPE`, start/end, `END`, `SVLEN`, breakend orientation, imprecision (`CIPOS`/`CIEND`), interval overlap, and reciprocal-overlap/breakpoint tolerance parameters.
- STR: locus/repeat catalog ID plus motif/repeat-unit and locus coordinates; STRs are not reliably keyed by `chr,pos,ref,alt`.

Changing identity or matching parameters creates a new snapshot. Fixtures must include below-threshold non-matches and ambiguous/multi-match cases.

## Sync and Reannotation Semantics

Sync is controlled snapshot application, not arbitrary two-way synchronization.

- Public -> Private is the normal direction.
- Private DB records the active/pinned public snapshot per import/reannotation job.
- Promoted values needed for filtering, sorting, audit, or clinical review are materialized in the private DB with provenance.
- Restricted values are either withheld or materialized only through an entitlement/escrow process; absence must be explicit (`withheld`), not silent.
- Reannotation is an explicit, idempotent job that produces a diff/report. It does not silently update clinical decisions or user annotations.
- Same input + same snapshot + same mapping version must produce deterministic materialized annotation output.
- Changed source data, transform code, identity model, license classification, or mapping version creates a new snapshot or materialization version.

## Evidence Escrow

Restricted-source values that cannot be public may require an escrow/private materialization path.

Planning requirements:

- escrowed fields never appear in the public snapshot by value;
- each escrowed field has entitlement/license evidence before materialization;
- materialized private evidence records include source, snapshot, escrow version, entitlement ID, timestamp, and field provenance;
- no entitlement means zero escrowed values plus explicit withheld markers;
- escrow access is audited;
- revocation/takedown creates tombstones and future withholding without destroying already-audited private clinical conclusions unless an operator/legal decision requires it.

## Audit, Logging, and Query Leakage

The design reduces authorization ambiguity but does not make audit trivial.

Private audit records:

- authentication and workspace selection;
- imports, exports, deletes, reannotation jobs, snapshot applications;
- user annotations/comments/tags/ACMG changes;
- admin/break-glass access;
- backup/restore and permission changes where observable;
- failures and denied attempts where useful without leaking payloads.

Public audit records:

- snapshot staging, validation, release, deprecation, revocation;
- source/license manifest used;
- publisher/migrator identity and checksums;
- no private workspace, case, sample, user, genotype, or private variant identifiers.

Logging rules:

- no VCF lines, genotypes, sample IDs, patient names, HPO/free clinical text, raw manifests, local patient paths, or variant batches in normal logs;
- error serialization must scrub private coordinates and identifiers before leaving the private boundary;
- private DB statement logs, slow-query logs, WAL/PITR archives, metrics with labels, and traces inherit case-data sensitivity if they can contain private query content;
- public DB query logs can leak private intent through lookup parameters and access sequences; disable parameter logging or classify those logs as sensitive.

## Admin and Break-Glass

DBA, host-root, backup operator, and compromised app-process risks are not solved by this boundary.

The plan must state the trust model:

- whether DBAs/superusers are trusted operators;
- whether private workspaces share one Postgres instance or use separate instances;
- whether break-glass access is allowed, and if so with ticket/reason, MFA, time limit, alert, and audit;
- no local dumps on laptops unless explicitly controlled;
- restore into a weaker/shared environment is prohibited unless reviewed and audited.

Do not claim tenant isolation against a malicious superuser unless deployment topology actually enforces it.

## Provisioning, Migrations, and Failure States

Provisioning must be idempotent and resumable.

Required state machine:

- `requested`;
- `creating`;
- `migrating`;
- `active`;
- `failed`;
- `quarantined`;
- `deprovisioning`;
- `deleted`.

Requirements:

- control DB is source of truth, not "database exists";
- advisory lock per workspace during provisioning/migration;
- deterministic DB/role names from opaque workspace ID; no PII in names;
- bidirectional orphan reconciliation: DB without registry row, registry row without DB;
- per-DB migration version and app compatibility matrix;
- expand/contract migration discipline for rolling deploys;
- failed workspace migration is quarantined and not served by incompatible code;
- public snapshot schema changes are versioned; released snapshots are not mutated in place.

No cross-DB operation may require atomicity unless a future design explicitly adds two-phase commit. Use outbox/saga/retry/correlation IDs for multi-DB workflows.

## Pooling and Runtime Health

DB-per-workspace changes connection economics.

Planning requirements:

- separate control, public, and workspace pool classes;
- lazy workspace pool creation, idle TTL, LRU eviction, and a global connection budget;
- written `max_connections` arithmetic for a target workspace count, with superuser/reserve margin;
- backpressure behavior when pool budget is exhausted;
- PgBouncer mode decision and real-driver test through PgBouncer;
- named/prepared statement compatibility check in transaction pooling mode;
- avoid session-level `search_path` assumptions left over from schema-per-project;
- liveness must not require DB access;
- readiness checks control DB, public DB read-only path, migration compatibility, and pool saturation, but must not synchronously ping every workspace DB.

Annotation DB down behavior must be defined: hard readiness failure, degraded mode, or block only annotation-dependent workflows.

## Backup, Restore, and Retention

Backups inherit the data class of the source.

- Private workspace backups and WAL/PITR are case-data class: encrypted, access-controlled, auditable, and subject to operator retention policy.
- Public annotation DB backups are lower privacy risk but license-bound; backup/restore/redistribution may still be restricted by source terms.
- Control DB backup is operationally critical because it maps workspaces to private DBs.
- Restore must reconcile control registry with physical workspace DBs and public snapshot pointers.
- Restore emits audit events.
- Erasure/deprovisioning must consider active DB, backups, WAL archives, audit retention, legal hold, and deletion quarantine.

No productive auto-deletion of case data or audit events is introduced by this planning track; retention periods remain operator/DPO decisions.

## Impact on Annotation Bundle Planning

The annotation-bundle importer must be designed against this boundary.

- Bundle import writes sensitive data only to the private workspace DB.
- Bundle manifests and reports are case-data class unless explicitly public-cleared.
- Bundle manifests must describe exact paths, required versus optional files,
  indexes, checksums, sample/run identifiers, genome build, tool/resource
  versions, schema version, import ordering, and failure semantics.
- Public snapshot references in bundle manifests must be pinned by snapshot ID, source checksums, genome build, and mapping version.
- License/data-class gate runs before completeness/import gates.
- Public snapshot publication is separate from private bundle import.
- Raw evidence remains private unless a field is explicitly classified public and license-cleared.
- STR planning must preserve both STR VCF and Straglr TSV sidecars when present,
  with locus/repeat-catalog identity, repeat-unit normalization,
  genotype/copy-number semantics, and VCF-to-TSV linking rules.
- AnnotSV TSV planning must define required columns, SV/CNV join strategy,
  transcript/source context, dosage fields, optional-layer presence, and null
  semantics before adapter implementation.
- Promoted versus raw storage must be field-explicit: caller INFO, sanitized
  caller evidence, VEP/ANN/CSQ, AnnotSV, Straglr, and source columns each need a
  storage class, provenance rule, and promotion rule.

## PR Sequence

Planning is split into two VarLens web-track PRs plus an external deployment/operator stream.

### VarLens web-track PRs

1. **web 11 - Hosted DB Foundation:** web-only control/private/public DB contract, desktop guardrail, runtime config expectations, role boundaries, migration/readiness semantics, test strategy, and operator handoff requirements. No annotation bundle mapper in this PR.
2. **web 12 - Annotation Bundle Integration:** bundle manifest adapter, SNP/SV/CNV/STR/AnnotSV/Straglr mapping, first-class versus raw/provenance storage, public snapshot reference, import report, reannotation semantics, and tests. No new platform topology decisions in this PR.

### Deployment/operator stream

Deployment repositories consume the app contract and own:

1. platform-owned resource model, chart values, database/role/secret wiring, pooling, backup/restore, and dev/test/prod rollout;
2. concrete databases/clusters, roles, secrets, jobs, pooling, backups, restore drills, monitoring, and release wiring after the app contract is accepted.

### Follow-up specs feeding web 11/web 12

- **Data classification + license matrix spec:** source/field classifications, fail-closed release gates, attribution bundle, blocklist.
- **Public snapshot spec:** schema skeleton, immutable release model, validation, staging/activation, no-private-data scan.
- **Audit/logging/ops spec:** private audit, public publish audit, log redaction, backup/restore, break-glass.
- **Annotation bundle/import spec:** private import, snapshot pinning, evidence escrow/materialization, reannotation jobs.

Implementation PRs must follow those specs. The first implementation PR should not change annotation workflow outputs before the DB boundary and snapshot contract are accepted.

## Web 11 V1 Decisions

These decisions are closed for the Web 11 hosted DB foundation contract, while
broader alternatives can remain future work:

- hosted sensitive mode uses one private PostgreSQL database per workspace;
  schema-per-project remains only a legacy/developer/single-instance path unless
  a later ADR reopens it;
- request runtime uses per-workspace app credentials, not one shared private DB
  credential across all workspaces;
- the control DB is the Web 11 v1 workspace routing source;
- private workspace credential handoff uses non-secret control-DB references to
  operator-mounted credential files;
- user/workspace provisioning is triggered by the IAC/operator CLI and uses a
  one-shot VarLens image command for app-semantic registration, not request-time
  app runtime infrastructure privileges;
- normal request runtime validates migration compatibility and does not run DDL;
- `/healthz` remains a readiness-compatible endpoint for existing probes, while
  Web 11 adds `/livez` for process liveness and `/readyz` for bounded readiness.

## Acceptance Gates

Planning PR gates:

- ADR names and resolves conflict with schema-per-project planning.
- Cross-DB annotation strategy is chosen or explicitly blocked as a follow-up decision before implementation.
- Co-tenancy/topology threat model is explicit: shared instance vs separate instances; DBA/root trust boundary stated.
- Repository ownership is explicit: VarLens owns app/runtime contracts, deployment/operator repositories own deployed infrastructure resources, and the annotation repository owns bundle/snapshot production contracts.
- Web-only guardrail is explicit: no desktop SQLite behavior, packaging, or local/offline promises are changed by this planning track.
- Every new persistent data path has a data class and retention owner.
- License matrix is fail-closed and contains a default blocklist.
- No overclaims: no compliance guarantee, no anonymization claim, no "public DB is risk-free".
- Web 11 proves routing/connection isolation only until authenticated workspace
  membership checks are implemented and tested; do not overclaim tenant
  authorization.

Implementation gates for later PRs:

- Public DB schema/fixtures scan proves no private identifiers or restricted fields.
- Role negative tests prove runtime cannot write public DB, cannot DDL private DB, and cannot access another workspace DB.
- Public snapshot build fails on unknown/restricted license fixture.
- Snapshot ID recomputes deterministically from manifest and data.
- Reannotation with identical input is a no-op; changed source produces new snapshot/materialization diff.
- Private case write + private audit rollback atomically in one private DB.
- Multi-DB workflows have retryable outbox/saga state, not silent partial writes.
- PgBouncer test uses the production pooling mode and real driver path.
- Connection-budget math stays under configured Postgres/PgBouncer limits.
- Restore drill covers one private workspace DB, control registry reconciliation, and public snapshot pointer verification.
- Logs/metrics/traces tests prove no private variant/sample/genotype payloads are emitted to technical logs.
- Break-glass emits audit and alert, expires automatically, and cannot be used silently.

## Open Decisions Before Implementation

1. Legacy/developer mode: exact long-term support boundary for schema-per-project or single-DB deployments outside hosted sensitive mode.
2. Are workspace DBs in one shared Postgres instance, multiple instances, or provider-managed per-workspace instances?
3. Are DBAs/host-root trusted operators, or must deployment isolate against them?
4. Public annotation use: app-side materialization, `postgres_fdw`, private replicated subset, or offline signed snapshot bundles?
5. Cross-workspace analytics: non-goal, app-level fan-out, or separate warehouse?
6. Credential rotation path for the Web 11 v1 per-workspace mounted-secret model.
7. Control DB runtime dependency: cached routing or hard SPOF?
8. Evidence escrow: in private workspace DB, separate entitlement-controlled DB, or deferred?
9. Which deployment resource boundary is chosen for public/private/control databases: same PostgreSQL cluster with separate databases/roles, multiple PostgreSQL clusters, or provider-managed instances?
10. Does the Helm chart expose the Web 11 v1 mounted-secret contract directly, or does a future VarLens version discover workspace routing through a platform provisioner/control service?
11. Which final interface will the deployment repository use for the one-shot
    VarLens image command: direct `node out/web/provision-user.cjs`, a wrapped
    npm script, or a chart-owned Job template?

These decisions must be closed in `.planning` before code changes that assume one of the answers.
