**TL;DR:** Make filters trustworthy, then make them easy to build. The implementation exploration exposed several cross-layer contracts that isolated UI or parser tests miss. Its useful lessons are now preserved in 14 VarLens issues and updates to two existing issues; implementation remains proposed work.

**Suggested order**

1. Preserve Boolean meaning and validate complete typed expressions (#526–#527).
2. Align cohort field mappings and show the actual applied state (#528–#529).
3. Surface query failures and correct evidence labels (#530–#531).
4. Build guided, accessible query entry on those contracts, then repair navigation/layout (#532–#536).
5. Extend complete ranking, custom INFO filtering and interval evidence (#537–#539).

**Implementation lessons worth retaining**

- A flat field map cannot faithfully represent every Boolean expression. Reject unsupported shapes atomically before adding richer transport.
- Cohort changes must reach renderer canonical names, repository allowlists, summary SQL and fallback SQL. Check actual matching IDs, counts and exports on both backends.
- Draft input, applied conditions, removable chips and serialized URLs must agree. Reload/back/forward tests catch conditions that otherwise reappear after removal.
- Vuetify may apply a role to both wrapper and input. Inspect rendered DOM; check the open suggestion popup, contrast, keyboard behavior and feedback placement.
- Force validation when Apply/Enter is pressed; a stale debounced error must not block corrected input.
- Keep preferred drawer width separate from viewport-constrained width, and test overlay interaction as well as dimensions.
- Display CNV/SV intervals and declared build using existing metrics and plots. Read-depth or BAF curves require real series data.
- Reuse existing helpers and state owners. No additional query framework or dependency is justified for the first correctness fixes.

**Published issues**

| Priority | Issue | Kind | Archived guide |
| --- | --- | --- | --- |
| P1 | [#526 — fix(dsl): preserve Boolean meaning or reject unsupported expressions](https://github.com/berntpopp/VarLens/issues/526) | Bug | [Guide](01-dsl-boolean.md) |
| P1 | [#527 — fix(dsl): validate complete expressions and typed values before applying](https://github.com/berntpopp/VarLens/issues/527) | Bug | [Guide](02-dsl-validation.md) |
| P1 | [#528 — fix(cohort): align DSL field names across validation and both backends](https://github.com/berntpopp/VarLens/issues/528) | Bug | [Guide](03-cohort-fields.md) |
| P1 | [#529 — fix(filters): show applied DSL conditions and preserve them through URL restoration](https://github.com/berntpopp/VarLens/issues/529) | Bug | [Guide](04-applied-state.md) |
| P1 | [#530 — fix(variants): show failed queries and identify stale results](https://github.com/berntpopp/VarLens/issues/530) | Bug | [Guide](05-query-errors.md) |
| P1 | [#531 — fix(shortlist): derive ClinVar pins from actual STR annotations](https://github.com/berntpopp/VarLens/issues/531) | Bug | [Guide](06-str-evidence.md) |
| P2 | [#532 — feat(filters): make query entry guided, readable and keyboard accessible](https://github.com/berntpopp/VarLens/issues/532) | Enhancement | [Guide](07-search-ux.md) |
| P2 | [#533 — fix(cohort): dispatch filter shortcuts to the active view](https://github.com/berntpopp/VarLens/issues/533) | Bug | [Guide](08-shortcuts.md) |
| P2 | [#534 — fix(filters): keep the drawer usable at narrow widths and browser zoom](https://github.com/berntpopp/VarLens/issues/534) | Bug | [Guide](09-drawer-layout.md) |
| P2 | [#535 — fix(cohort): preserve exact variant identity during carrier drilldown](https://github.com/berntpopp/VarLens/issues/535) | Bug | [Guide](10-carrier-navigation.md) |
| P2 | [#536 — fix(cohort): preserve genome build in reloadable view URLs](https://github.com/berntpopp/VarLens/issues/536) | Bug | [Guide](11-cohort-build.md) |
| P2 | [#537 — feat(shortlist): rank the complete candidate set independently of import order](https://github.com/berntpopp/VarLens/issues/537) | Enhancement | [Guide](12-shortlist-ranking.md) |
| P2 | [#538 — feat(filters): expose stored custom INFO values as typed case filters](https://github.com/berntpopp/VarLens/issues/538) | Enhancement | [Guide](13-info-fields.md) |
| P2 | [#539 — feat(cnv): add build-aware interval and carrier evidence views](https://github.com/berntpopp/VarLens/issues/539) | Enhancement | [Guide](14-cnv-workspace.md) |

**Existing issue updates**

- [#124 implementation guide](https://github.com/berntpopp/VarLens/issues/124#issuecomment-6096825387) — [archived text](existing-124-guide.md).
- [#93 implementation guide](https://github.com/berntpopp/VarLens/issues/93#issuecomment-6096825746) — [archived text](existing-93-guide.md).

**Evidence and limits**

Source recheck: `7989c395`; earlier browser observations used synthetic cases at `8c2e01b4`. The original audit reports and reproduction helpers are in the parent directory. Their historical defect probes are not a current passing test suite.

Already-fixed numeric-control initialization, cohort Clear all, preset divergence/recovery, cross-case shortlist rows and literal SQL substring handling were excluded from new issues. Prototype-only regressions are recorded as implementation pitfalls, not asserted as current product defects.

The earlier baseline passed CI (7,286 tests; 258 skipped), and eight sampled browser states reported no axe violations. Those checks do not validate these proposed fixes or establish complete accessibility. This issue-only pass checked publication and document contents; it changed no application source and merged no implementation. Production-scale ranking, desktop IGV and screen-reader behavior remain acceptance work. No Lighthouse score was measured.

