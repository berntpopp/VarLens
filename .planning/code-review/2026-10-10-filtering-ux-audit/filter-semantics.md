# VarLens filtering semantics audit — 2026-10-10

What this repo does: VarLens imports variant data and lets users narrow case and cohort results with drawer controls, column filters, and a text filter language. This audit assumes one analyst using a case or cohort interactively, with the same filter expected to mean the same thing in SQLite and PostgreSQL. No load benchmark was needed to reproduce the findings below.

Scope: DSL tokenizer, parser, expression tree, translator, autocomplete, renderer integration, numeric and extension filter controls, shared value/null validation, case/cohort query emitters, and INFO-field storage. No production code was changed.

Snapshot: the initial HEAD was `6de042dde31e628b0bfd5305775f5e87102c4737`; the final inspected HEAD is `8c2e01b480e0dd09a8b47aff2ad722314468d0d7`, both on `chore/sprint-1-hardening-cleanup`. During the audit three source files changed and were committed: `PostgresVariantReadRepository.ts`, `createPostgresStorageSession.ts`, and `VariantTable.vue`. The intervening diff contains 3 insertions and 15 deletions; it does not touch the finding locations below. A further concurrent modification to `VariantTable.vue` was present at handoff. None of these source edits was made by this worker. An untracked audit-artifact directory belongs to the wider audit.

Evidence: three successful `node` heredoc probes used installed TypeScript to load the actual source in memory. They exercised parser/translator output, PostgreSQL SQL generation, and a compiled Vue component's setup handlers. One probe executed the generated SQL against an in-memory database using Node's built-in SQLite module; it did not load or rebuild the application's native SQLite module. Findings distinguish those executed probes from source tracing and new capabilities. Existing tests were read, not run by this audit worker.

Executable reproduction: [reproduce-filter-semantics.cjs](./reproduce-filter-semantics.cjs), with [captured sanitized output](./filter-semantics-probe-output.json). Run `node .planning/code-review/2026-10-10-filtering-ux-audit/reproduce-filter-semantics.cjs` from the repository root. It completed with exit 0 and 20 reproduced checks at the final inspected HEAD. Exit 0 means the recorded defects reproduced, not that the application contract passes; every output record states the desired behavior. The script uses no server, application database, network, native rebuild, or on-disk temporary database.

## Must fix

### 1. P1 — A valid-looking DSL expression changes meaning during translation

**Classification and confidence:** confirmed bug; high confidence, actual parser and translator executed.

**What this is:** The parser preserves AND/OR groups in an expression tree, but the translator reduces them to one condition per column. The backend receives a flat map and ANDs its entries.

**Trigger, actual, expected:**

| User input | Actual translated filter | Expected |
|---|---|---|
| `cadd:>=:20 AND cadd:<=:30` | `cadd <= 30` | Both bounds, or a clear unsupported-expression error |
| Same conditions reversed | `cadd >= 20` | Same results regardless of AND order |
| `cadd:<:10 OR cadd:>:20` | `cadd IN ('10','20')` | Values below 10 or above 20 |
| `gene:=:BRCA1 OR cadd:>=:20` | Gene AND CADD | Either condition |
| `gnomad_af:<:0.01 OR gnomad_af:is:null` | Numeric IN list containing `''` | Rare or missing AF; actual output fails numeric validation |

All five parse without errors. The cross-column case creates a warning, but the integration exposes only parser errors, so the user never sees it. A CADD value of 5 passes the first expression even though it fails the intended lower bound. With cross-column OR, variants that meet only one branch are lost.

**Exact source:** `src/renderer/src/dsl/translator.ts:87` assigns by column, overwriting an earlier condition; `:103–120` converts every same-column OR to IN without checking operators and changes other OR groups to AND; `:123–126` flattens AND. `src/renderer/src/composables/useDslFilterIntegration.ts:37–47,67–80,119–125` does not surface translator warnings. `src/renderer/src/dsl/autocomplete.ts:197–209` explicitly offers OR as “Any condition can match.” `src/shared/types/column-filters.ts:49–50` defines the flat map.

**Smallest fix and reuse:** Before emitting anything, reject expressions that the current map cannot represent: repeated columns under AND, non-equality same-column OR, and cross-column/nested OR that cannot be lowered without loss. Show that error through the existing DSL error channel and keep the last applied results. Keep same-column equality OR as IN. Full arbitrary boolean support is a separate contract change: retain the tree through transport and use parameterized recursive emission; the existing full-text boolean emitter in `src/shared/utils/boolean-search.ts:141–150` demonstrates that shape, but its text-term parser must not replace typed DSL validation.

**Affected callers:** `useDslSearch` → `useDslFilterIntegration` → case `FilterToolbar` and `CohortFilterBar`; both backends; any saved/shared search text entering those paths. The drawer's deliberately single-bound numeric controls do not need to become a general visual expression builder for this fix.

**Existing tests and acceptance:** `tests/renderer/dsl/translator.test.ts` tests AND with different columns and individual null checks, but no repeated-column AND or OR translation. Parser tests only check that OR produces a group. Add a table-driven parser→translator test for the expressions above and a renderer test proving rejection does not emit a partial filter. If full expression support is implemented, assert actual result IDs on both backends with CADD 5/10/15/20/25/35/NULL and genes that satisfy only one OR branch.

**Issue-ready:** `fix(filters): reject DSL expressions whose AND/OR semantics cannot survive translation`. Entering a supported-looking compound expression currently broadens, narrows, or reverses the intended result set. Preserve every condition or report an actionable error before applying; no silent overwrite, OR-to-AND conversion, or range-to-IN conversion. This is a new finding beyond the closed backend parity work in VarLens #447.

### 2. P1 — Cohort DSL filters use field names the cohort queries silently discard

**Classification and confidence:** confirmed SQL-generation bug; high confidence. PostgreSQL generation was executed; the matching SQLite drop is source-demonstrated.

**What this is:** Case and cohort use the same DSL registry, while cohort query keys differ and available fields differ between backends.

**Trigger, actual, expected:** In cohort, enter `cadd:>=:20` and press Enter. The DSL emits `column_filters.cadd`, while both cohort builders accept `cadd_phred`; neither adds a CADD predicate. Entering `cadd_phred:>=:20` does not work around it because that alias resolves back to `cadd`. Applying the DSL also clears the drawer's `minCadd`, so it can remove a previously effective restriction. PostgreSQL probes returned `whereParts: []`, `values: []`, and `unavailable: false`; direct backend input using `cadd_phred` emitted `(cvs.cadd IS NULL OR cvs.cadd >= $1)`.

There is also a backend mismatch in the same field contract: SQLite's cohort allowlist includes `cdna` and `aa_change`; PostgreSQL's cohort column-filter allowlist omits both, although its summary has those columns. `cdna:~:123` therefore filters SQLite and is ignored by PostgreSQL. Shared autocomplete additionally offers case-only fields such as `qual` and `gt_num` that neither cohort path applies.

**Exact source:** `src/renderer/src/dsl/column-registry.ts:54–58` canonicalizes CADD aliases; `src/renderer/src/components/cohort/CohortFilterBar.vue:475–483` uses the shared DSL and clears drawer CADD; `src/renderer/src/components/CohortTable.vue:283–291` passes the map unchanged; `src/renderer/src/composables/useCohortData.ts:339–341` serializes it unchanged. `src/main/database/cohort.ts:42–47,148–154` accepts `cadd_phred` and drops unrecognized keys. `src/main/storage/postgres/postgres-cohort-summary-query.ts:198–212,494–503` does the same, additionally omitting cDNA/protein keys.

**Smallest fix and reuse:** Accept `cadd` as the canonical filter key in both cohort builders while retaining `cadd_phred` for compatibility; add cDNA/protein entries to PostgreSQL's existing map. Supply a scope-specific set of allowed fields to the existing registry/autocomplete and validation, hiding or explicitly rejecting unsupported cohort fields. Do not silently discard a filter that the interface advertises as active.

**Affected callers:** Cohort toolbar and drawer DSL, column-filter payload assembly, cohort queries and exports on both backends. Existing saved API filters using `cadd_phred` must keep working.

**Existing tests and acceptance:** The range/null/invalid-value cases in `tests/main/storage/variant-filter-backend-parity.test.ts:527–547,696–712,787–798` deliberately submit `cadd_phred` to cohort, so they bypass this failure. `tests/renderer/dsl/column-registry.test.ts` checks a hard-coded case field list. Add UI/DSL→query tests for `cadd`, its alias, cDNA and protein, including an existing drawer CADD restriction. Every advertised cohort field must either produce a predicate with matching result IDs on both backends or show a validation error.

**Issue-ready:** `fix(cohort): align DSL field keys with the cohort filter contract`. CADD expressions currently remove the drawer restriction and generate no replacement condition; cDNA/protein column filters also differ by backend. Keep aliases compatible, close the supported-field mismatch, and test from DSL input through query generation. Related to VarLens #447 and #515, but distinct from their repaired panel/numeric-validation and plain-text HGVS paths.

### 3. P1 — New numeric SV/CNV/STR drawer filters cannot be entered

**Classification and confidence:** confirmed component-state bug; high confidence. The actual compiled component setup was executed; a browser click sequence was not run by this worker.

**What this is:** `NumericRangeControl` chooses one operator and one value for each numeric extension field.

**Trigger, actual, expected:** Open the CNV section with no copy-number filter. The value field is disabled because the operator is undefined. Selecting `=` calls `updateOperator`, which returns because there is no value, without storing the chosen operator. The value field stays disabled. The probe reported `operator: null`, `inputDisabled: true`, and `emitted: []` both before and after choosing `=`. Users should be able to select `=`, enter `0`, and filter homozygous deletions; the same deadlock affects every fresh numeric extension filter.

**Exact source:** `src/renderer/src/components/filters/NumericRangeControl.vue:22,80–92,95–105`. `ExtensionColumnControl.vue:26–32` chooses this control for every `number` field. `ExtensionColumnFilters.vue:16–22` starts an absent field with an undefined model.

**Smallest fix and reuse:** Keep the selected operator as local draft state, initialized from the model or a displayed default, and emit a filter only once a finite value exists. Synchronize external model replacement/clear. Preserve the current single-bound protocol; adding range UI is unnecessary for this repair.

**Affected callers:** `FilterDrawer.vue:530`, `CohortFilterDrawer.vue:395`, and `AssociationConfigPanel.vue:170` all mount the shared extension control tree.

**Existing tests and acceptance:** `tests/renderer/components/filters/ExtensionColumnFilters.test.ts:151–175` bypasses the control by directly emitting its completed `update:modelValue` event. Add a real child-control interaction test starting from `{}`: choose `=`, type `0`, assert the emitted copy-number filter, clear, then enter another value. Verify loaded preset values still initialize and can be edited.

**Issue-ready:** `fix(filters): retain the draft operator in numeric extension controls`. An empty numeric control requires a value to save its operator and an operator to enable its value, blocking every fresh SV/CNV/STR numeric filter. Break the circular dependency locally and test the actual select/input flow. This is separate from the closed base CADD/AF field repairs in VarLens #504.

### 4. P1 — The DSL accepts a valid prefix while ignoring malformed trailing input

**Classification and confidence:** confirmed parser bug; high confidence, parser executed.

**Trigger, actual, expected:** Each of `gene:=:BRCA1 cadd:>=:20`, `gene:=:BRCA1)`, `gene:=:BRCA1 AND`, and an unterminated `gene:=:"BRCA1` returns `errors: []` and the single BRCA1 rule. The first looks like a two-condition query but applies no CADD restriction. A committed query must consume the entire input, require the operand after a combinator, and require closing quotes and balanced parentheses.

**Exact source:** `src/renderer/src/dsl/parser.ts:49–54` returns without checking that all tokens were consumed; `:107–109,117–119` permits an absent operand after AND/OR. `src/renderer/src/dsl/tokenizer.ts:84–100` emits a value even without a closing quote, and `:129–132` silently skips otherwise unrecognized punctuation.

**Smallest fix and reuse:** Add end-of-input validation to `Parser.parse`, report missing terms after combinators, and carry lexical errors for unclosed strings/unrecognized characters into the existing `DslParseError` result. The existing position/length error model and `useDslSearch.ts:54–57` already prevent translation when errors exist. Keep useful partial-input autocomplete, but do not accept a partial expression on Enter.

**Affected callers:** Both DSL bars, URL-restored expressions through `useSearchUrlParam`, and every downstream query built from their output.

**Existing tests and acceptance:** `tests/renderer/dsl/parser.test.ts` covers an incomplete leaf and mixed unparenthesized AND/OR, but not leftover tokens or trailing combinators. Tokenizer tests cover closed quoted values only. Add the four examples plus a valid escaped quote and correctly nested groups; assert invalid input produces an error and no filter update.

**Issue-ready:** `fix(dsl): validate the complete expression before applying filters`. Missing AND, extra closing parentheses, trailing combinators, and unclosed quotes currently apply the valid prefix with no error. Reject the whole malformed input, retain the previous applied query, and identify the offending span. No matching existing VarLens issue was found in the supplied inventory.

### 5. P1 — The DSL does not enforce field/operator/value validity before coercion

**Classification and confidence:** confirmed semantic-validation bugs; high confidence, parser/translator and SQL generation executed.

**Trigger, actual, expected:**

| Input | Current effect | Required behavior |
|---|---|---|
| `gene:!~:BRCA` | Positive contains BRCA | Reject unsupported operator, or implement real not-contains |
| `gene:^:BRCA` / `gene:$:BRCA` | Contains BRCA anywhere | Reject unsupported operator, or implement actual prefix/suffix |
| `gnomadd_af:<:0.01` | SQLite ignores the unknown field; PostgreSQL case builder throws | Same inline unknown-field error before querying |
| `cadd:=:""` or a quoted blank | Parser coerces blank to 0; backend validation then passes | Reject an absent numeric comparison value; keep explicit 0 distinct |
| `cadd:<:abc` | Parser reports success, backend rejects later | Inline invalid numeric-value error |

The in-memory SQL probe for `cadd:=:""` selected the row with zero CADD. `cadd:is:null` correctly selected the separate NULL row, demonstrating that missing-value behavior has already been fixed in the backend and this bypass is earlier in the pipeline.

**Exact source:** `src/renderer/src/dsl/parser.ts:25–38,149–150,172–183,233–244` uses a global operator set, accepts unresolved field names, and converts with `Number()` before testing for blank input. `src/renderer/src/dsl/column-registry.ts:33–37` intentionally excludes unsupported operators, but the parser never checks the field's operator list. `src/renderer/src/dsl/translator.ts:39–44,78–82` maps not-contains/prefix/suffix to ordinary contains. `src/shared/filters/column-filter-validation.ts:87–89,103–114` rejects raw numeric blanks but cannot recover a blank that was already changed into zero. `src/main/database/variant-filter/column-filters.ts:119–121` ignores unknown fields; `src/main/storage/postgres/postgres-variant-column-filters.ts:35–40` rejects them.

**Smallest fix and reuse:** Resolve the field, check its supported operators, and validate its raw value in both explicit and shorthand parser paths before coercion. Register supported extension keys from `VARIANT_EXTENSION_REGISTRY` rather than accidentally removing their current explicit DSL support. Reuse shared numeric validation semantics; preserve dedicated null checks, which now work even though the registry's comment still calls them unsupported. Remove the misleading translator fallbacks for unsupported operators. Apply scope checks from finding 2.

**Affected callers:** All DSL entry points, both backends, and active-filter labels that currently count unsupported inputs. Existing explicit extension queries such as `cnv.copy_number:<:2` are a compatibility requirement.

**Existing tests and acceptance:** `tests/shared/filters/column-filter-validation.test.ts` explicitly tests raw blank rejection, but parser tests do not pass a quoted blank through that validator. Tokenizer tests recognize `!~` without testing its query meaning. Add parser→validator→translator cases for all rows above, aliases, explicit zero, null checks, and an extension numeric field; invalid inputs must not emit a query or clear existing drawer state.

**Issue-ready:** `fix(dsl): validate typed field rules before translating or coercing them`. Unsupported operators currently invert or weaken user intent, unknown fields differ by backend, and blank numeric values become zero. Enforce the existing field/operator contract before conversion, keep extension fields and null checks working, and reject invalid rules in the search bar. This is additional renderer-side coverage beyond the repaired numeric backend validation in VarLens #447.

### 6. P2 — “Contains” treats HGVS underscores and percent signs as wildcards

**Classification and confidence:** confirmed SQL semantics bug relative to the displayed substring wording; high confidence. **Already tracked in open VarLens #521; update that item rather than create a duplicate.**

**Trigger, actual, expected:** Enter `cdna:~:"c.1_2del"`, or apply an equivalent text-column filter. The generated pattern is `%c.1_2del%`; SQL treats `_` as any one character, so both `c.1_2del` and `c.112del` match. The probe returned those two rows plus the legitimate substring match `c.1_2delinsA`. Expected literal contains returns only the two rows containing the actual underscore. `%` and backslash need an equally explicit policy.

**Exact source:** `src/main/database/variant-filter/column-filters.ts:44–51`, `src/main/database/variant-where-builder.ts:258–261`, `src/main/database/variant-extension-registry.ts:292–295`, `src/main/storage/postgres/postgres-variant-column-filters.ts:67–71`, and `src/main/storage/postgres/postgres-cohort-summary-query.ts:354–360` wrap unescaped values with percent signs. The DSL calls this operator “Contains” in `src/renderer/src/dsl/autocomplete.ts:44`, and `TextFilterControl.vue:9` says “Substring match.”

**Smallest fix and reuse:** Reuse `escapeLikePattern` from `src/main/database/search/search-clause-emitter.ts:102–103` and an explicit `ESCAPE` clause in the column-filter emitters. Existing full-text/HGVS term paths already do this. Audit SQL conversion in `PostgresAssociationDataBuilder` when changing shared emitted SQL, as #521 already notes. If wildcard patterns are intentionally supported, expose them as a separate, clearly named operation instead of changing contains semantics invisibly.

**Affected callers:** DSL, text column popups, extension drawer text controls, case/cohort/export/burden SQL using these emitters. Saved filters that intentionally relied on undocumented wildcards need an explicit compatibility decision.

**Existing tests and acceptance:** `tests/main/database/variant-filter-builder.test.ts:372–380` covers ordinary BRC substring matching. Search-only underscore tests exist in `tests/main/database/search/cohort-search-emitter.test.ts`, `variant-search-service.test.ts`, and `tests/main/storage/postgres-cohort-summary-query.test.ts:158–170`; they do not cover column filters. Add a cross-backend column-filter result-set test for `_`, `%`, and backslash using literal and near-match rows, plus the existing plain-text search route.

**Issue-ready update for #521:** Add the reproduced `cdna:~:"c.1_2del"` false-positive example, the five emitter locations, and literal-substring acceptance cases. Closed VarLens #503/#515 repaired plain-text HGVS routing; this remaining column-filter path still needs the shared escaping helper.

## Should fix / new capability

### 7. P2 — Make stored custom INFO fields available as typed advanced filters

**Classification and confidence:** new capability, not a regression; high confidence about current storage/filter boundaries. No claim that an existing documented custom-field query is broken.

**Trigger, actual, expected for this enhancement:** Import a VCF with an unmapped numeric field such as `CUSTOM_SCORE=0.8`, then try to restrict results to values above 0.5. Import preserves the value in `info_json` and shows that storage destination in the preview, but neither the filter registry, drawers, nor query builders offers a typed field to select. A proposed advanced section should list only fields actually present in the case, show their type and missing count, and apply the chosen scalar condition consistently on both backends.

**Exact source:** `src/main/import/vcf/info-field-registry.ts:70–71,104–110` preserves unmapped entries as strings; `src/main/import/vcf/VcfMapper.ts:187` serializes them. `src/renderer/src/components/import/VcfPreviewStep.vue:75–105` shows field type/cardinality and the `info_json` destination. `src/renderer/src/dsl/column-registry.ts:39–175` is a fixed base-field list; `src/main/database/variant-filter/sortable-columns.ts:19–45` and PostgreSQL's column definitions contain no arbitrary INFO-field access. Searches of the active filtering emitters found no JSON-field extraction. `src/shared/types/variant-extension-registry-data.ts:36–114` provides the existing reusable typed extension-field pattern.

**Smallest complete scope and reuse:** Start with scalar numeric/text INFO fields and explicit “missing/has value,” reusing the current typed controls, column metadata queries, and parameter binding. Retain or derive validated per-case metadata, including VCF Type and Number; do not infer safe numeric comparison from string shape alone. Arrays, absent keys, explicit missing values, and flags need distinct definitions before being enabled. A first version can mark unsupported cardinalities as unavailable with a clear reason. Dynamic field paths must be validated and values parameterized. A scalar prototype should measure realistic query cost before introducing JSON indexes or changing all storage to JSONB.

**Affected callers and contracts:** VCF field metadata persistence/discovery; SQLite/PostgreSQL column metadata and predicate construction; drawer controls; DSL field suggestions and validation; filter serialization/presets/export; cohort support requires an explicit rule for representative versus any-carrier values. Avoid advertising cohort custom fields until that aggregation meaning is defined.

**Existing tests and acceptance:** `tests/main/import/vcf/info-field-registry.test.ts` verifies INFO mapping/storage, not filtering. Add one tiny VCF fixture with scalar numeric/text fields, an absent key, a missing marker, zero, and a multi-value field. Assert scalar comparisons and missing checks return the same variant IDs on both backends; unsupported arrays must be explained, not silently string-compared. Verify saved filters restore the field identity/type and reject a missing field in a different case.

**Issue-ready:** `feat(filters): expose imported scalar INFO fields in an advanced filter section`. Preserve the existing simple drawer; add discoverable typed filters for unmapped imported annotations, with clear missing-value behavior and guarded cardinality. Define a small scalar-first scope and defer array quantifiers and cohort aggregation until their meaning is specified. No equivalent issue was found in the supplied VarLens inventory.

## Strengths and boundaries

- Missing-value operators now have their own transport values and a shared SQL helper. Numeric NULL is distinct from zero; text checks include NULL and empty string. These repairs are present in current source and were verified in the SQL probe.
- Shared numeric backend validation rejects non-finite/non-numeric comparisons consistently; the remaining gap in finding 5 is input validation before numeric coercion.
- The extension registry is already shared by renderer and backend, and extension filters intentionally exclude missing extension rows while base numeric ranges include NULL by default. That policy is documented; this audit does not call the difference a defect.
- Category equality for impact and ClinVar uses normalized severity through shared helpers. Do not replace that with ordinary substring matching while unifying the filter model.
- The backend parity suite checks explicit expected variant sets across case/cohort/export paths, not just equality between two potentially wrong implementations. Its missing boundary is renderer DSL output.
- DSL has no unary NOT node. `NOT gene:=:BRCA1` currently fails parsing; arbitrary nested NOT is a new language capability, not a currently accepted operation. Plain-text boolean search has a separate NOT implementation.
- Array-valued `ColumnFilter.value` currently means an IN operand list. It does not provide element-wise matching over stored INFO arrays. The custom-field enhancement must make that distinction explicit.
- Two smaller interface findings were left out of the seven ranked items: the cohort DSL advertises `@preset` names but supplies no `resolvePreset` callback (`CohortFilterBar.vue:475–484`); autocomplete context does not follow valid lower-case combinators/parentheses and still omits now-supported null operators (`autocomplete.ts:74–120`, `column-registry.ts:33–35`). These were source/probe observations, not expanded standalone issues here.

Existing-issue check: the supplied 88-issue VarLens inventory was inspected. #521 already owns wildcard column-filter semantics; closed #447, #503, #504 and #515 contain related completed work, but do not resolve the current UI-to-DSL/query counterexamples above. No issues were created or changed by this worker.

Verdict: first stop silent changes to filter meaning, repair cohort field mapping, and unblock the extension numeric control. Expand advanced filtering only after the current query contract is trustworthy.

Not checked: full Vitest/CI, native application SQLite, live PostgreSQL execution, browser interaction, import performance, Unicode collation parity, or exhaustive preset/export behavior. No ABI rebuild, dependency change, server/browser launch, checkout, commit, or push was performed by this worker; only this report, its reproduction script, and captured output were written.
