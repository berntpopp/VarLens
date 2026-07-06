---
name: varlens-verify-before-done
description: Use when about to claim a VarLens change is done, working, fixed, or ready to commit/PR — to pick and run the right make target for what you changed and report its actual output. Symptoms of about to skip this: "the diff looks clean", "types should pass", "this is a trivial change", "I'll let CI catch it", or claiming a UI change works without opening the app.
metadata:
  version: "1.0.1"
  updated: "2026-07-06"
---

# VarLens: verify before claiming done

## The rule

**Run the relevant `make` target and report its actual outcome. Never infer success
from a clean diff or from "it should work".** Evidence before assertions. If you can't
run verification in this environment, say so explicitly — don't imply it passed.

This is the repo's own top gate (`make ci` is the local minimum; `make ci-full` is the
canonical go/no-go). For the general discipline see
`superpowers:verification-before-completion`; this skill adds the VarLens command matrix.

## Which target for which change

| Your change touches | Run (minimum) |
|---|---|
| Any code at all | `make typecheck` |
| Anything you'll commit | `make ci` (lint-check + format-check + typecheck + rebuild-node + test) |
| Renderer, IPC, database, or workers | `make rebuild-node && make test` (then `make ci`) |
| Electron lifecycle, packaging, worker bootstrap, native module | `make ci-full` (includes startup smoke + packaged smoke) |
| A UI component | Build/run the app and **look at it** — `make dev` or `/run`. A diff that typechecks is not a working UI. |

`make ci` deliberately serializes the heavy gates to bound peak memory. On this machine,
wrap heavy runs in a memory cap: `systemd-run --user --scope -p MemoryMax=16G make ci-full`.

## Order of operations (the native-ABI trap)

Tests run on the **Node ABI**; the app runs on the **Electron ABI**. `make ci` /
`make test` need `make rebuild-node` first, or the SQLite module ABI-fails and the run is
invalid — not a pass, not a real fail. If tests won't load `out/main/db-worker.js` or you
see `NODE_MODULE_VERSION` errors, that's ABI, not your code — see `varlens-native-rebuild`.

## Reporting

State what you ran and what it printed:

- ✅ "Ran `make ci` — lint, format, typecheck, and the full test suite passed (report the count `make test` prints)."
- ✅ "`make test` fails: `useFilters.test.ts` expects the new field. Fixing the test."
- ✅ "Typecheck passes. Could not run `make ci-full` here (no Electron display); startup smoke unverified."
- ❌ "Done — the change looks correct." (no command run)
- ❌ "This should pass CI." (prediction, not evidence)

## Never

- **Never lower a coverage / lint / typecheck threshold to make a red suite green.** Add
  tests or fix the code. Lowering the bar is a cover-up, not a fix. (Baselines like
  `scripts/agent-health-baseline.json` are not to be relaxed to fit new code either.)
- **Never claim a UI change works without opening the app.** Screenshot or drive it.
- **Never report "tests pass" when they were skipped, or when the ABI was wrong.** A
  skipped or ABI-failed run is not a pass — say which happened.
