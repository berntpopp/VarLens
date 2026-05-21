# Agent Health Violation Remediation

## Purpose

VarLens now blocks new oversized source files and growth in known oversized files. The next step is
to reduce the committed baseline so future Claude/Codex work has smaller context surfaces and clearer
ownership boundaries.

## External Guidance Considered

- Anthropic's Claude Code best-practices guidance says context-window pressure is the core constraint
  for agentic coding, and that model performance degrades as sessions accumulate file contents and
  command output. Source: https://code.claude.com/docs/en/best-practices
- Anthropic's memory guidance recommends concise, specific, structured project instructions and a
  target under 200 lines per project instruction file; it also recommends path-scoped rules when
  instructions grow large. Source: https://code.claude.com/docs/en/memory
- Anthropic's large-codebase guidance describes Claude Code navigating repositories like an engineer:
  walking files, using search, and following references. That rewards files whose names and boundaries
  match their responsibilities. Source:
  https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
- Google Gemini Code Assist guidance emphasizes selected code/context, repository context, custom
  commands/rules, and asking how to test generated or migrated code. Source:
  https://docs.cloud.google.com/gemini/docs/codeassist/use-code-customization and
  https://docs.cloud.google.com/gemini/docs/codeassist/chat-gemini

The practical conclusion for this repository: keep frequently touched files small enough for an agent
to read in one pass, preserve exact verification commands, and avoid rewrites whose only result is line
movement without stronger boundaries.

## Current Inventory

`make agent-check` reports 24 oversized source files:

- Storage/import/backend: `VariantFilterBuilder.ts`, `VariantRepository.ts`,
  `PostgresCohortRepository.ts`, `postgres-import-worker.ts`, `seed-dev-workspace.mjs`.
- IPC/preload/contracts: `src/preload/index.ts`, `src/main/ipc/handlers/panels.ts`,
  `src/shared/types/api.ts`, `src/shared/types/database.ts`, `src/shared/types/ipc-schemas.ts`.
- Renderer components: `CaseList.vue`, `CohortTable.vue`, `VariantTable.vue`, `FilterDrawer.vue`,
  `FilterToolbar.vue`, `ImportWizard.vue`, `VcfImportDialog.vue`, cohort filter/data components.
- Renderer composables/mocks: `useAnnotations.ts`, `useGeneStructurePlot.ts`,
  `useLollipopPlot.ts`, `mockApi.ts`.

Six oversized tests are report-only and should be split opportunistically when their covered feature is
touched. They do not block this remediation phase.

## Goals

- Remove baseline entries in small, reviewable batches without changing user-visible behavior.
- Prefer extraction by stable responsibility: types, helpers, render sections, adapters, and pure
  utilities.
- Add or update focused tests when a split changes behavior, exposes a new helper, or moves logic out
  of a component/composable.
- Keep every touched authored source file at or below 600 lines by the end of the batch.
- Keep `make agent-check` as the objective measure of progress.

## Non-Goals

- Do not attempt to clear all 24 files in one PR.
- Do not rewrite large Vue components into a new design system.
- Do not change IPC channel names, database schemas, import semantics, or public preload API shape.
- Do not split generated, migration, or fixture files; they are intentionally ignored by the checker.

## Remediation Strategy

### Batch 1: Contract and Preload Splits

Start with low-risk, type-heavy files:

- Split shared contract/type barrels that already have nearby domain files.
- Extract preload API assembly into small domain grouping helpers while preserving `window.api`.
- Update preload contract tests if type exports or API shape tests need path changes.

This batch gives the largest context reduction with the lowest runtime risk.

### Batch 2: Panel IPC and Script Split

- Move panel handler sub-responsibilities into existing `panels-logic.ts` or new focused helpers.
- Split `seed-dev-workspace.mjs` into argument parsing, database setup, and seed data assembly.
- Cover moved helper behavior with existing script or IPC tests where direct behavior is observable.

### Batch 3: Renderer Component Extractions

- Split reusable table/filter subviews into child components.
- Move pure state derivation into composables when it is currently embedded in components.
- Add component tests only for moved behavior that is not already covered by existing tests.

### Batch 4: Plot and Annotation Composables

- Extract plot layout, scales, tooltip formatting, and renderer-independent calculations.
- Add unit tests for pure helpers before moving behavior.

### Batch 5: Storage and Import Repositories

- Split query construction and row mapping from repository orchestration.
- Keep transaction boundaries and worker message contracts unchanged.
- Rely on existing database/import tests plus focused helper tests for newly exposed pure functions.

## Acceptance Criteria

- Each batch has a dedicated PR and removes at least one source entry from
  `scripts/agent-health-baseline.json`.
- `make agent-check` passes and reports fewer baseline oversized source files than before the batch.
- `make ci` passes before a batch is considered ready.
- Any moved behavior has either existing test coverage identified in the PR or a new focused test.

