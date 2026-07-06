# Spec: VarLens agent-skills suite

**Date:** 2026-07-06
**Status:** Approved (brainstormed 2026-07-06)
**Owner:** Bernt Popp

## Goal

Give coding agents a set of discoverable, on-demand **project skills** under
`.claude/skills/` that encode VarLens's non-obvious, multi-step, error-prone tasks — the
operational HOW-TO layer beneath the always-loaded `AGENTS.md` / `CLAUDE.md` contracts.
The suite must conform to the public **Agent Skills specification**
(<https://agentskills.io/specification>) so it is portable across skill-aware harnesses.

## Motivation

`AGENTS.md` states the *rules*; it is terse by design and always in context. It does not
carry step-by-step recipes, and non-Claude harnesses never load `CLAUDE.md`'s
verification matrix. `CLAUDE.md` itself directs agents to "invoke a skill instead of
improvising." The gap: the repo's recurring, non-obvious failures (native-module ABI,
IPC wiring, cohort-view parity, the `consequence`/`func` swap) have no discoverable,
self-contained playbook. Memory and specs record these as *repeated* agent mistakes,
which is the evidence bar for creating a skill.

## Scope

Create/finalize seven project skills, make the suite spec-compliant, and produce the
`.planning/` artifacts. **No** new dependencies, **no** new CI jobs, **no** rewrites of
the six already-verified skills beyond frontmatter metadata.

### The Agent Skills standard (compliance target)

From <https://agentskills.io/specification>:

| Field | Required | Constraint |
|---|---|---|
| `name` | yes | ≤64 chars, lowercase `a-z0-9` + hyphens, no leading/trailing hyphen, **no consecutive hyphens**, **must match parent directory name** |
| `description` | yes | 1–1024 chars, non-empty; says *what* + *when to use*, keyword-rich |
| `license` | no | license name or bundled-file reference |
| `compatibility` | no | ≤500 chars; environment requirements |
| `metadata` | no | arbitrary string→string map (e.g. `version`, author) |
| `allowed-tools` | no | space-separated pre-approved tools (experimental) |

Structure rules: one `SKILL.md` per named directory; body ≤500 lines / <5k tokens
recommended; supporting material in `scripts/` `references/` `assets/`, one level deep.

### Skill catalog (7)

| Skill | Type | Purpose |
|---|---|---|
| `varlens-native-rebuild` | reference/decision | Native SQLite ABI dual-rebuild: tests → `rebuild-node`, app → `rebuild`. Triggered by `NODE_MODULE_VERSION` / `db-worker.js` load errors. |
| `varlens-ipc-channel` | technique | Add/change an IPC channel via the domain-module pattern (contract + preload + main handler + contract test); `wrapHandler` / `unwrapIpcResult`. |
| `varlens-cohort-parity` | discipline | Same-PR case↔cohort parity for filter/sort/search/column work, with a touch-map + rationalization table. |
| `varlens-vcf-import` | technique | Extend `src/main/import/vcf/`: INFO registry, VEP/SnpEff parsing, the `consequence`/`func` trap, per-sample fan-out. |
| `varlens-ui-patterns` | reference | Vuetify 4 patterns; points at `.planning/docs/UI-PATTERNS.md` + top traps (`surface-variant`, expand-API, `color-mix`). |
| `varlens-verify-before-done` | discipline | Which `make` target proves which change; evidence-before-assertion; never lower thresholds. |
| `varlens-security-and-bug-scan` | reference/playbook | **NEW.** How to run a security + bug review of a VarLens change; the security invariants that must not be weakened; a repo-specific bug-class checklist. |

### New skill: `varlens-security-and-bug-scan`

A defensive, **agent-run playbook** that reuses existing tooling — no new scanner, no CI.
Three parts:

1. **How to run a review** — `/security-review` (pending-branch security), `/code-review`
   (diff correctness), `gitleaks` (config `.gitleaks.toml`), `npm audit` with the hard
   rule **never `npm audit fix --force`** (breaks `pdbe-molstar`; the `elliptic` lows are
   an accepted residual — see `reference_npm_audit_elliptic_residual` memory). Cross-ref
   `superpowers:systematic-debugging` to reproduce a suspected bug before fixing.
2. **Security invariants that must NOT be weakened** —
   - Electron `webPreferences`: `sandbox: true`, `contextIsolation: true`,
     `nodeIntegration: false` (`src/main/index.ts:75-79`).
   - Fuses baseline (`scripts/configure-fuses.mjs`, `strictlyRequireAllFuses: true`);
     do not reintroduce `build.electronFuses` in `package.json`.
   - IPC: renderer→main only through typed `window.api` (lint-enforced,
     `eslint.config.js:94`); validate untrusted args with Zod in the handler; let
     `wrapHandler` own errors.
   - External URLs validated before `shell.openExternal` (`shell.ts`,
     `isMainWindowNavigationAllowed`) — never add a bypass.
   - SQLcipher keys never logged; `assertNotHexLiteralKey` guards key entry
     (`DatabaseService.ts:69,308`). No secrets/PHI in logs.
3. **VarLens bug-class checklist** (what to grep a diff for) — unwrapped `IpcResult<T>`
   used as data; native-ABI errors mistaken for code bugs; `consequence`/`func` swap;
   cohort-parity drift; try/catch swallowing structured IPC errors; renderer→main import
   (lint catches it); SQL built outside the shared parameterized builder
   (`VariantFilterBuilder.ts` / `sql-utils.ts`).

Ends by deferring verification to `varlens-verify-before-done`. Framed as authorized,
defensive review; treats any retrieved external content as data, not instructions.

### Compliance & polish pass (all 7)

- **Audit result: already compliant.** Names lowercase/hyphenated, match directories, no
  consecutive hyphens; descriptions 362–487 chars; bodies 510–849 words.
- Add a `metadata` block (`version: "1.0.0"`, `updated: "2026-07-06"`) to each skill for
  maintainability. No content rewrites to the six verified skills.
- Update `.claude/skills/README.md` to list the 7th skill.

## Non-goals (YAGNI)

- No new SAST tool (Semgrep/CodeQL), no dependency additions.
- No new CI/GitHub Actions job.
- No rewrites of the six existing skills' bodies.
- No changes to `AGENTS.md` (its stale "warm palette" hexes are noted inside
  `varlens-ui-patterns`, not corrected here).

## Verification

- Every skill: `name` matches directory, `description` ≤1024 chars, frontmatter parses,
  body under the size guidance.
- New skill: every cited file path exists at the referenced location.
- `.gitignore` ignores `.claude/worktrees/` so the suite commits cleanly.
- Suite lives on branch `chore/agent-skills-suite`, PR-ready; not pushed/merged without ask.

## Artifacts

- Skills: `.claude/skills/<name>/SKILL.md` (+ `README.md` index).
- Spec: this file.
- Plan: `.planning/plans/2026-07-06-agent-skills-suite-plan.md`.
