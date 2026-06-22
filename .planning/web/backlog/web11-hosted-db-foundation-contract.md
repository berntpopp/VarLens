# Web 11 hosted DB foundation contract

Status: backlog / contract draft
Created: 2026-06-22

## Why This Exists

Web 11 changes the web storage contract from "one Postgres URL" to an explicit
hosted topology:

- one control database for workspace registry and routing state
- one private Postgres database per workspace for sensitive case data
- one public annotation read path for immutable, license-cleared snapshots

This document is the app-side contract. It does not implement the topology and
does not define Kubernetes, Helm, CloudNativePG, PgBouncer, backups, or operator
runbooks.

Desktop remains unchanged. The Electron app keeps the encrypted local SQLite
path and must not require any hosted-mode variables.

## Topology Modes

Web mode supports two planned topology modes:

| Mode | Purpose | Required DB config |
| --- | --- | --- |
| `single` | Existing developer/simple web path | `VARLENS_PG_URL`, optional `VARLENS_PG_SCHEMA` |
| `hosted` | Web 11 target for sensitive hosted workspaces | control DB URL, workspace DB routing, and a selected public annotation access strategy |

`single` keeps the current web behavior and remains useful for local tests,
simple demos, and migration compatibility. It is not the target boundary for
hosted sensitive genomic workspaces.

`hosted` is the Web 11 target. It must be selected explicitly and must fail
closed when required configuration is incomplete.

Hosted production deployments must assert hosted mode explicitly. If hosted-only
variables are present while the topology is still `single`, startup must fail or
emit an operator-visible refusal rather than silently running the weaker
single-DB boundary.

## Planned Runtime Environment

The names below are the planned Web 11 handoff names. If implementation review
renames any of them, this planning contract must be updated before the operator
handoff is considered complete.

| Variable | Mode | Required | Purpose |
| --- | --- | --- | --- |
| `VARLENS_WEB_DB_TOPOLOGY` | web server only | no | `single` by default for dev/current compatibility; `hosted` enables Web 11 topology checks. Desktop must not read it. |
| `VARLENS_PG_URL` | `single` | yes | Existing single Postgres URL. |
| `VARLENS_PG_SCHEMA` | `single` | no | Existing schema selector; defaults to `public`. |
| `VARLENS_CONTROL_RO_PG_URL` | `hosted` | yes | Control DB read connection for users, sessions, membership, workspace registry, routing metadata, and migration compatibility. |
| `VARLENS_CONTROL_STATE_PG_URL` | `hosted` | yes | Narrow Control DB write connection for sessions, selected-workspace state, and access audit only. It must not mutate membership, routing refs, secret refs, or provisioning state. |
| `VARLENS_PUBLIC_ANNOTATION_PG_URL` | `hosted` | conditional | Read-only app connection only if Web 11 chooses live public-DB lookup. Offline/materialized snapshot designs must not require this variable. |
| `VARLENS_WORKSPACE_DB_SECRET_DIR` | `hosted` | yes | Directory containing operator-mounted private workspace DB credential files addressed by non-secret control-DB references. |
| `VARLENS_CONTROL_POOL_MAX` | `hosted` | no | Max clients across both Control DB app pools; default `4`. |
| `VARLENS_PUBLIC_ANNOTATION_POOL_MAX` | `hosted` | conditional | Max clients for the public annotation read path when live DB lookup is selected; default `4`. |
| `VARLENS_WORKSPACE_POOL_IDLE_MS` | `hosted` | no | Idle TTL for private workspace pools; default `300000`. |
| `VARLENS_WORKSPACE_POOL_MAX` | `hosted` | no | Max clients per private workspace pool; default `2`. |
| `VARLENS_WORKSPACE_POOL_GLOBAL_MAX` | `hosted` | no | Max total private workspace clients across all private workspace pools; default `20`. |

Do not make desktop startup read these variables.

`hosted` mode must not require or fall back to `VARLENS_PG_URL`. A legacy
`VARLENS_PG_URL` may be ignored with a startup warning, but the warning must
name only the variable, never its value, and it must not become a silent fallback
path once `VARLENS_WEB_DB_TOPOLOGY=hosted` is selected.

Web 11 v1 uses the control DB as the workspace routing source. Do not add a
pluggable resolver variable until there is a second concrete resolver mode with
tests and an operator contract.

The Web 11 v1 secret-resolution contract is mounted-file based:

- control DB stores a non-secret `workspace_db_secret_ref`
- the app resolves it as a filename under `VARLENS_WORKSPACE_DB_SECRET_DIR`
- the file contains the private workspace DB connection URL for the
  workspace-scoped app role
- the app rejects absolute paths, `..`, missing files, mismatched workspace IDs,
  and credentials whose database or role does not match the control-DB metadata
- future platform resolver APIs are follow-up work and must update this contract

## Control DB Contract

The control DB contains routing, auth/session, workspace membership, and
operational state only. It must not contain variants, genotypes, samples,
clinical text, user comments, ACMG decisions, raw VCF lines, or private
annotation values.

Control DB state is not public. User/session/membership/access-audit records are
access-controlled operational and audit data, and session tokens or secret refs
follow the `auth_material` class in the ADR.

Minimum app-visible control state:

- workspace ID
- workspace status from the canonical lifecycle in
  `../../specs/2026-06-22-public-private-annotation-db-boundary.md`
- user, session, membership, selected workspace, and access-audit state for
  hosted web mode
- private workspace DB connection reference and non-secret routing metadata
- private workspace schema/migration version
- migration set ID applied to the private DB
- compatibility target expected by the running app; this is a compiled app
  migration set ID derived from the bundled migration files
- optional public annotation snapshot defaults

The control DB must not store plaintext private workspace DB passwords. It may
store secret references, database names, role names, and non-secret routing
labels. For Web 11 v1, runtime connection material is resolved from
operator-mounted credential files under `VARLENS_WORKSPACE_DB_SECRET_DIR`.
Platform resolver APIs are future work and must update this contract before use.

The app must refuse to serve a workspace when:

- the workspace is not `active`
- the workspace migration version is incompatible
- the secret reference cannot resolve a private DB connection
- the route/session workspace does not match an authenticated membership record

Request handling order in hosted mode:

1. authenticate the request and load the session from the control DB
2. determine the selected workspace from the route or session
3. verify membership/role before resolving a private DB connection
4. resolve the workspace DB connection reference and migration version
5. create or reuse the private workspace pool
6. bind storage execution to that workspace pool only

No app request may directly create, drop, or mutate physical databases. Web 11
does not introduce an app-admin provisioning HTTP API. Provisioning is triggered
by the deployment/operator repository, usually through an operator CLI that is
allowed to create a short-lived Kubernetes Job. Physical database creation, role
creation, credential materialization, and migrations run through that platform
job/operator with credentials that are never mounted into normal request
runtime. VarLens contributes only the app-semantic command carried in the web
image, for example creating an application user from a precomputed password
hash with `must_change_password=TRUE`.

The minimal operator-triggered provisioning lifecycle is:

1. operator runs the IAC CLI with a low-sensitivity username/workspace slug,
   display name, and either an operator-generated temporary password or a
   precomputed Argon2id hash
2. IAC creates the private database, owner/migrator/app roles, and app
   credential secret
3. IAC starts a one-shot VarLens image Job with only the app DB credentials it
   needs for semantic user/workspace registration
4. the VarLens image command writes app user/workspace metadata, forces
   `must_change_password=TRUE`, and does not create infrastructure resources
5. IAC records non-secret routing metadata and transitions the workspace to
   `active`, or to `failed` / `quarantined` with redacted error details
6. normal request runtime can route to the workspace only after membership,
   status, secret reference, and migration compatibility checks pass

The operator CLI must not accept free-form clinical notes, patient identifiers,
sample IDs, local paths, or raw manifests. Control DB provisioning state is
operational/audit data, not private case data.

Web 11 uses the existing web authenticated-session model plus a hosted
membership table. OIDC is out of scope, but the minimal authenticated session,
workspace membership, and role check required before DB resolution are in scope.
Web 11 establishes routing and connection isolation only after those checks are
implemented and tested.

## Private Workspace DB Contract

The private workspace DB is the only write target for sensitive case data.

Expected private content:

- cases, samples, variants, genotypes
- raw VCF INFO, `CSQ`, and `ANN`
- uploaded/imported file metadata
- user annotations, comments, tags, shortlists, ACMG evidence
- private audit events for private writes
- promoted public annotation values with snapshot and mapping provenance
- raw bundle sidecar evidence after Web 12

Request runtime must connect with a workspace-scoped app role. It must not use
database owner, migration, provisioner, superuser, or public annotation publisher
credentials.

Hosted request-time storage sessions validate the private DB migration version
and fail closed when incompatible. They must not run DDL migrations during normal
request handling; private DB migrations are executed by an operator/migrator path
outside request runtime.

Private writes and their private audit records stay in the same private
workspace DB transaction.

## Public Annotation DB Contract

The public annotation boundary stores immutable released snapshots and source
metadata that are license-cleared for shared use. The exact access strategy must
be selected before Web 12 adapter implementation, and before Web 11 introduces
any public annotation runtime connection. Candidate strategies are live
read-only public DB lookup, read-only FDW, replicated released subset, or
offline/materialized snapshot bundles.

If a runtime public DB connection is selected, read-only access is enforced by
the database role/grant. App-layer write rejection is defense in depth, not the
primary boundary.

The normative public/private data boundary is
`../../specs/2026-06-22-public-private-annotation-db-boundary.md`. The local
summary is: no private identifiers, no genotype/phenotype payloads, no
case-linked clinical/user annotations, no access tokens, and no private query or
cohort history in the public annotation boundary.

Unknown or restricted license state is fail-closed. Web 12 can materialize
restricted values into private workspace DBs only through an explicit entitlement
or escrow path; it must not place them in the public annotation DB.

Public annotation lookup behavior when the public read path is unavailable must
be explicit before implementation: either hard readiness failure, degraded mode
that blocks annotation-dependent workflows only, or no runtime dependency for
offline/materialized designs.

## Workspace Pool Contract

Hosted mode cannot eagerly open one pool per workspace.

Required behavior:

- create workspace pools lazily
- evict idle pools after a TTL
- enforce the `VARLENS_WORKSPACE_POOL_GLOBAL_MAX` private-workspace client
  budget; control and public annotation pools are configured and budgeted
  separately
- document connection arithmetic as:
  `control_pool_max + public_pool_max_if_enabled + workspace_pool_global_max + reserve <= deployed Postgres/PgBouncer connection budget`
- fail with a controlled service error when pool budget is exhausted
- keep readiness checks bounded; do not ping every workspace DB on `/healthz`

Planned endpoint semantics:

- `/livez`: process-only liveness, no DB access
- `/readyz`: bounded readiness for control DB, selected public annotation read
  path when applicable, migration compatibility, and pool saturation
- `/healthz`: compatibility alias for readiness during Web 11, so existing
  container smoke checks still prove the app can serve with its configured DB
  dependencies; operators should use `/livez` for restart decisions and
  `/readyz` for traffic routing once both endpoints exist

## Logging Contract

The normative logging rules are in
`../../specs/2026-06-22-public-private-annotation-db-boundary.md`. The local
summary is: normal logs, metrics labels, traces, health output, and CI artifacts
must not include private genomic payloads, clinical text, local patient paths,
auth material, full connection URLs, raw manifests, or public lookup batches.

Errors must be redacted before they cross the private boundary into HTTP
responses, process logs, metrics, traces, or health output.

Public annotation lookups can still leak private variant intent through access
patterns. Treat those query parameters, traces, statement logs, slow-query logs,
`pg_stat_statements`, and high-cardinality metrics as sensitive. Opaque
workspace-ID-labeled metrics are technical logs, but their timing and volume can
still reveal access patterns and must be access-controlled.

## Acceptance Checks

### Unit

- topology config parser: `single` defaults, `hosted` fail-closed behavior, and
  hosted-only-variable refusal when topology is accidentally left as `single`
- workspace resolver behavior for active, failed, quarantined, and missing
  workspaces
- error redaction helpers for private variant/log payloads
- public annotation client rejects write-capable code paths at the app API layer
  when live/FDW lookup is selected

### Integration

- current `single` topology still boots with `VARLENS_PG_URL`
- `hosted` topology boots against disposable control and workspace DBs, plus
  the selected public annotation read path when applicable
- workspace A route cannot access workspace B connection reference after
  membership verification
- unauthenticated or non-member requests do not resolve private DB connections
- private write plus private audit rollback atomically in one workspace DB
- public annotation runtime path uses read-only methods only when live/FDW
  lookup is selected
- connection-budget arithmetic is documented for the selected deployment target

### Desktop Regression

- desktop tests run without hosted web variables
- desktop SQLite import path remains unchanged
- shared renderer/API types remain additive or mode-gated

### Operator-Owned Negative Tests

These are not app-repo implementation requirements, but Web 11 must document
them so deploy repositories can verify the real grants:

- runtime cannot write public annotation DB
- runtime cannot create/drop databases
- runtime cannot run migrations
- runtime cannot access another workspace DB with the wrong credential
- runtime Control DB roles cannot mutate platform-owned routing references,
  secret references, or provisioning state
- app request runtime cannot run the VarLens one-shot provision-user command
- publisher/migrator roles are not present in request runtime

These checks are required before a hosted-sensitive deployment is considered
ready, even if they run in the deployment/operator repository rather than the app
repository.

## Out Of Scope

- Annotation bundle adapter and mapping. That is Web 12.
- Public snapshot schema population.
- OIDC implementation.
- Cross-workspace analytics.
- Desktop SQLite migration.
- Kubernetes, Helm, CloudNativePG, PgBouncer, backup, restore, or runbook code
  beyond the narrow VarLens image command contract. Those live in the deployment
  repository.

DB-per-workspace is a boundary against ordinary routing, role, and application
mistakes. It does not defend against a malicious superuser, DBA, host root, or
compromised app process unless the deployment topology explicitly provides that
separation.

## Exit Criteria

Web 11 planning is ready when:

- topology modes and runtime variables are documented
- per-workspace runtime credentials, mounted secret-reference resolution, and
  migration compatibility handshake are documented
- public annotation runtime strategy is either chosen for Web 11 or explicitly
  absent from Web 11; Web 12 remains blocked until the strategy is selected
- desktop guardrails are explicit
- control/private/public DB responsibilities are separated
- app-level and operator-level tests are not mixed
- Web 12 can rely on a private workspace DB plus public annotation snapshot
  reference without reopening the DB boundary decision
