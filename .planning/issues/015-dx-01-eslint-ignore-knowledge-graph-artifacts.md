---
id: "DX-01"
number: 15
title: "ESLint ignore pattern missing AI analysis directories (.understand-anything, .ua)"
priority: "P3 - Medium"
tags: ["dx", "ci", "tooling"]
affected_files:
  - "eslint.config.mjs"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DX-01] ESLint ignore pattern missing AI analysis directories (.understand-anything, .ua)

| Attribute | Value |
|---|---|
| **Priority** | **P3 - Medium** |
| **Tags** | `dx` `ci` `tooling` |
| **Affected Files** | `eslint.config.mjs` |
| **Audited Snippet** | `ESLint default ignore pattern does not include .understand-anything/** or .ua/**, causing CI failure...` |

---

## Technical Context & Audited Impact
Breaks developer workflow and CI checks when using codebase understanding tools.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

I've checked the ESLint config, `.gitignore`, the format scripts, and the artifact directory. The audit is only partly right, so I'm downgrading it. Here's the write-up.

---

## DX-01 review: ESLint doesn't ignore gitignored tool-artifact folders

### 1. Is the finding valid?

**Partly. The gap exists, but the claimed CI failure can't happen.**

- **The gap is real.** `eslint.config.mjs:17-36` lists folders to skip by name: `.planning/**`, `.agent/**`, `.claude/**`, `.impeccable/**` and others. `.understand-anything/**` isn't in that list. ESLint 10 (flat config) does **not** read `.gitignore` on its own, so `npm run lint:check` (`eslint .`) will scan anything under that folder that it treats as code.
- **CI can't break.** `.gitignore:159-160` ignores `.understand-anything/`, so CI checkouts never contain it. The "causing CI failures" part of the audit is wrong.
- **Nothing breaks locally today either.** The folder currently holds only `*.json` files and one `.understandignore`. The config loads no JSON plugin, so ESLint only checks `js/mjs/cjs`, `ts/tsx` and `vue` files. It skips JSON files.
- **Prettier isn't affected.** `format:check` only covers named paths (`*.{…}` at the root and `{src,tests,scripts,.github}/**`), so it never looks inside hidden folders.
- **`.ua` has no basis.** It isn't in `.gitignore`, doesn't exist on disk, and nothing in the repo refers to it. Leave it out.
- **The real cause is drift.** The skip list is copied by hand from `.gitignore`. Every new tool that writes to a hidden folder (`.impeccable` was added the same way) needs two edits, and missing one fails silently. That only shows up once a tool writes a `.js`, `.ts` or `.vue` file, for example a generated HTML dashboard with an inline script bundle or a scratch script.
- **Possible side effect (not measured):** if the tool later writes code files, `--cache --cache-strategy content` would hash them on every run and slow lint down.

### 2. Severity: **P3 (Medium)**, low urgency

Nothing breaks now, CI can't be affected, and the workaround is trivial. It's still worth fixing because the same gap will catch the next tool that writes to a hidden folder, and the cost is near zero.

### 3. Labels
`dx`, `tooling`, `lint`, `chore`

### 4. Issue specification

**Title:** `chore(lint): derive ESLint global ignores from .gitignore so tool-artifact dirs (.understand-anything) are never linted`

**Description & reproduction**
`eslint.config.mjs` keeps a hand-written skip list that has fallen behind `.gitignore`. `.understand-anything/` is gitignored but not ESLint-ignored. To reproduce locally:
```bash
mkdir -p .understand-anything && echo 'var x = 1' > .understand-anything/probe.js
npm run lint:check        # reports no-var / no-unused-vars in a gitignored artifact
rm .understand-anything/probe.js
```
The current artifacts (JSON only) don't trigger this, and CI isn't affected because the folder is never checked out there.

**Expected behavior**
Every gitignored path is also skipped by `eslint .`, with no second list to keep in sync. Lint results and timing don't depend on which local tool outputs happen to be on disk.

**Proposed fix**
1. **Preferred:** use the `.gitignore` as the single source of truth:
   ```js
   import { includeIgnoreFile } from '@eslint/compat'
   import { fileURLToPath } from 'node:url'
   const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url))
   export default [
     includeIgnoreFile(gitignorePath),
     { ignores: [/* only tracked-but-unlinted paths: docs/**, tests/e2e/**, src/renderer/public/**, **/*.d.ts, … */] },
     …
   ]
   ```
   `@eslint/compat` would be a new devDependency, so run `npm audit` before adding it. Then trim the hand-written list down to paths that are **tracked** but intentionally not linted.
2. **Minimal fallback** (no new dependency): add `'.understand-anything/**'` next to `.impeccable/**` on line 31, plus a comment saying new gitignored tool folders must be added here too.
3. **Don't** add `.ua/**`. Nothing in the repo refers to it.

**Verification:** `make lint-check` and `make typecheck`. Rerun the probe above and confirm it reports nothing. Optionally check that `make perf-build ONLY=lint` shows no lint slowdown.

---

All conclusions come from reading the config and scripts. I didn't run ESLint against the folder (that command wasn't approved), so the repro above hasn't been run. I made no code changes.

Separately, several MCP connectors couldn't be used this session. Gmail, Google Calendar, genereviews-link, gtex-link, phentrieve and sysndd need to be authorized in your claude.ai connector settings. pubator-link, gnomad-link, hgnc-link, mdr-mcp, mgi-link, mondo-link and uniprot-link failed to connect. None of them were needed for this review.
