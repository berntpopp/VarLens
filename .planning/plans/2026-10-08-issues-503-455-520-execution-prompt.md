# Execution prompt: issues #503, #455, #520 (Antigravity, Gemini 3.8 High)

Start Antigravity in the integration worktree, set the goal, then paste everything inside the
`<prompt>` block as the first message.

```bash
cd /home/bernt-popp/development/VarLens-wt/specs-455-503-520
agy --model gemini-3.8-flash-high --add-dir /home/bernt-popp/development/VarLens-wt
```

```text
/goal The three plans in .planning/plans/2026-10-08-*-plan.md are implemented on branch feat/cohort-identity-carriers-burden, every Opus review ends with "Verdict: Ship.", and `make ci`, `VARLENS_WEB=1 make test` and `make preflight-full` all pass on the committed HEAD. Nothing is pushed.
```

`/boost` may be switched on for more parallel workers. The prompt does not depend on it.

<prompt>

<role>
You are the lead engineer and orchestrator for one batch of work in the VarLens repository. You
delegate implementation to subagents, keep your own context for coordination, and you are
accountable for the final gate.
</role>

<context>
- Repository rules: read `AGENTS.md` in full before anything else. It overrides your defaults.
- You are in the integration worktree
  `/home/bernt-popp/development/VarLens-wt/specs-455-503-520`, on branch
  `docs/specs-455-503-520`. It holds three approved specs and three implementation plans.
- Plans (each names its spec in its header; read plan and spec together):
  1. `.planning/plans/2026-10-08-cohort-row-identity-carriers-plan.md` (issue #503)
  2. `.planning/plans/2026-10-08-max-carrier-cases-filter-plan.md` (issue #455)
  3. `.planning/plans/2026-10-08-burden-test-eligible-sites-plan.md` (issue #520, phase 1 only)
- The plans were written by reading the code at `bcbc86cf`. Their code was never executed. Line
  numbers can be off; match on the quoted code and on symbol names. If a step's expected failure
  or expected pass does not occur, find out why before you continue.
- Other sessions use other worktrees under `/home/bernt-popp/development/VarLens-wt/`. Leave them
  alone.
</context>

<working_style>
"Ponytail" rules apply to every line you and your subagents write:
- The smallest complete change that fully solves the task. Reuse what the codebase has.
- No abstraction, option, wrapper or "for later" code that a plan does not ask for.
- Finish every part the change needs: callers, tests, fixtures, types, both backends.
- Never cut validation at a trust boundary, error handling that prevents data loss, or
  accessibility.
- Follow the plans' test-first steps. One small test per new branch of logic is enough.
</working_style>

<lanes>
Create the integration branch first:
`git switch -c feat/cohort-identity-carriers-burden`

Then run two lanes in parallel, one `invoke_subagent` (`TypeName: self`) per lane, each in its
own git worktree and branch created from the integration branch:

| Lane | Worktree | Branch | Work |
| --- | --- | --- | --- |
| A | `/home/bernt-popp/development/VarLens-wt/lane-a-cohort` | `lane/a-cohort` | Plan 1 completely, then plan 2 |
| B | `/home/bernt-popp/development/VarLens-wt/lane-b-burden` | `lane/b-burden` | Plan 3 |

Why this split: plans 1 and 2 edit the same cohort query files, and plan 2 owns the only
migrations (SQLite v45, PostgreSQL 0028), so they are sequential. Plan 3 shares one file with
lane A (`src/shared/types/ipc-schemas.ts`, a different region), so it is parallel.

Setup in each lane worktree, once: `git worktree add -b <branch> <path>`, then in it
`git config --worktree --unset core.hooksPath || true`, `npm ci`, `make rebuild-node`.

Give each subagent: its worktree path, its plan path(s), the `<working_style>` and
`<hard_rules>` sections of this prompt verbatim, and the instruction to commit after each task
with the plan's Conventional Commit message.
</lanes>

<during_implementation>
Speed rule: while implementing, run ONLY the targeted test commands the plan steps name
(`npx vitest run <file>`). Do not run lint, format, typecheck, `make test`, `make ci` or
preflight inside a lane, even where a plan's last task or a per-task note says so. All of that
runs once, at the end, in `<final_gate>`.

PostgreSQL-gated tests (`VARLENS_RUN_POSTGRES_E2E=1`) need the dev database. Start it once with
`make pg-up`, read the port it actually listens on, and export `VARLENS_PG_URL` accordingly. Do
not assume port 55432. Give each lane its own schema or database so the lanes do not collide.
</during_implementation>

<adversarial_review>
When a lane has finished its last task, review it before merging. The reviewer is Claude Opus
5.5 through the Claude Code CLI, using its `ponytail-review` skill. Run from the lane worktree,
once per plan:

```bash
mkdir -p .planning/code-review
claude -p "Use the ponytail:ponytail-review skill. Review the change 'git diff feat/cohort-identity-carriers-burden...HEAD' on this branch. It implements the plan <PLAN_PATH> and the spec named in that plan's header; read both. Act as the adversary: look for wrong results, a broken caller, a missed backend (SQLite and PostgreSQL must both be done), a missing cohort-view counterpart, a risky branch without a test, and code that should not exist. Report only. Change no file." \
  --model claude-opus-5-5 --effort high --output-format text \
  --allowedTools "Read" "Grep" "Glob" "Skill" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git status:*)" \
  > .planning/code-review/2026-10-08-<plan-slug>-ponytail-review.md
```

Then:
1. Fix every "Must fix" and "Should fix" finding in the lane, test-first. If you believe a
   finding is wrong, verify it against the code and write one line in the review file saying
   why it was not applied.
2. Run the review again. Stop when it ends with `Verdict: Ship.`, or after three rounds; if it
   still does not say Ship, list the open findings in the final report.
3. Commit the review file with the lane.

Do not grade your own work in place of this review.
</adversarial_review>

<merge>
In the integration worktree: `git merge --no-ff lane/a-cohort`, then
`git merge --no-ff lane/b-burden`. Resolve conflicts by keeping both sides' intent. If
`scripts/agent-health-baseline.json` limits are exceeded after the merge, shrink the code; never
raise a number.
</merge>

<final_gate>
Run once, in the integration worktree, in this order. This machine kills processes that exceed
the memory cap, so prefix heavy commands as shown and run them one at a time.

1. `npm ci && make rebuild-node`
2. `npm run format` then `make lint` (both may rewrite files). Commit what they changed.
3. `systemd-run --user --scope -p MemoryMax=16G make ci`
4. `systemd-run --user --scope -p MemoryMax=16G env VARLENS_WEB=1 make test`
5. `make agent-check`
6. PostgreSQL-gated tests of the three plans with `VARLENS_RUN_POSTGRES_E2E=1`.
7. Commit everything, confirm `git status` is clean, then
   `systemd-run --user --scope -p MemoryMax=16G make preflight-full`
   (add `PREFLIGHT_ARGS=--electron-no-sandbox` only if the Electron launch fails on the sandbox).
8. `make rebuild build`, start the app, and look at: the cohort table carrier expansion, the
   "Seen in at most N cases" field in both filter drawers (light and dark theme), and the
   association results view with its new sentence.

A failing gate is fixed in the code, then steps 3 to 7 are run again from the failing step.
</final_gate>

<hard_rules>
- Never lower a coverage, lint, typecheck or budget threshold. Never add to a known-failures list.
- Never use `--no-verify`, `[skip ci]`, or skip a gate because a tool or database is missing.
- Do not push, open a pull request, tag, or merge into `main`.
- Do not run `git worktree prune`. Do not touch worktrees or branches you did not create.
- No `console.*`. No change to `src/shared/utils/par-regions.ts`. No chrX work (phase 2).
- No migration other than SQLite v45 and PostgreSQL 0028 from plan 2.
- If a step is blocked after two real attempts, stop that lane, record the exact command and
  output, and continue the other lane.
</hard_rules>

<final_report>
End with a report in this form, in plain sentences:
- Branch and commit of the integration HEAD.
- Per plan: tasks done, tasks not done and why.
- Per review: number of rounds, final verdict, findings not applied and why.
- Per gate step 1 to 8: the exact command and its result (pass, fail with the failing lines, or
  not run and why).
- Anything you changed that no plan asked for.
</final_report>

Start now: read `AGENTS.md`, then the three plans and their specs, create the integration
branch and the two lane worktrees, and dispatch both lanes.

</prompt>
