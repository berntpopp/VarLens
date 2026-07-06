# VarLens project skills

Project-scoped skills for coding agents (Claude Code and any harness that reads
`.claude/skills/`). These are the **HOW-TO playbooks** for the repo's multi-step,
error-prone, judgment-heavy tasks — the operational layer under the always-loaded
`AGENTS.md` / `CLAUDE.md` contracts. Agents load a skill on demand when its
`description` matches the task at hand.

Scope rule: these encode *judgment calls and multi-file recipes*, not mechanical
constraints. Anything a linter or `make agent-check` already enforces stays out.

| Skill | Use it when… |
|---|---|
| [`varlens-native-rebuild`](varlens-native-rebuild/SKILL.md) | A test or app run fails to load the native SQLite module (ABI / `NODE_MODULE_VERSION` errors), or before running Vitest vs. the Electron app. The repo's #1 footgun. |
| [`varlens-ipc-channel`](varlens-ipc-channel/SKILL.md) | Adding/changing an IPC channel between renderer and main — the domain-module pattern (contract + preload + main handler + contract test), `wrapHandler`/`unwrapIpcResult`. |
| [`varlens-cohort-parity`](varlens-cohort-parity/SKILL.md) | Touching filter/sort/search/column/metadata on the single-case OR cohort variant view. Enforces the non-negotiable "same-PR parity" gate with a touch-map. |
| [`varlens-vcf-import`](varlens-vcf-import/SKILL.md) | Extending the VCF import pipeline (`src/main/import/vcf/`): INFO-field registry, VEP/SnpEff parsing, the `consequence`/`func` trap, multi-sample fan-out. |
| [`varlens-ui-patterns`](varlens-ui-patterns/SKILL.md) | Building/changing renderer UI (Vue 3 + Vuetify 4): colors, backgrounds, dialogs, side panels, data tables. Points at `.planning/docs/UI-PATTERNS.md` + the sharpest traps. |
| [`varlens-verify-before-done`](varlens-verify-before-done/SKILL.md) | About to claim a change is done/working/fixed — which `make` target proves it, and reporting real output instead of inferring success. |
| [`varlens-security-and-bug-scan`](varlens-security-and-bug-scan/SKILL.md) | Reviewing a change for security or bugs before commit/PR — the security invariants that must not be weakened, plus a VarLens bug-class checklist. Uses existing tools only (no new scanner, no CI). |

## Maintaining these

- Skills conform to the **Agent Skills spec** (<https://agentskills.io/specification>):
  `name` is lowercase-hyphenated and matches its directory, `description` is ≤1024 chars,
  and each carries an optional `metadata` block (`version`, `updated`). Validate with
  `skills-ref validate ./<skill>` if the reference CLI is installed.
- Skills follow the `superpowers:writing-skills` methodology: lean, trigger-focused
  `description` (when to use, not what it does), one good example over many, discipline
  skills carry rationalization tables + red-flag lists.
- When a recipe here drifts from the code (file moved, pattern changed), fix the skill in
  the same PR as the code change — a stale playbook is worse than none.
- New skill candidates should clear the bar in `AGENTS.md` › "Skills over free-form
  instructions": a repeated, non-obvious, multi-step task where improvisation drifts.
