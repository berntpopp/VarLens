# Domain Pitfalls: Variant Annotation & Case Metadata (v0.4.0)

**Domain:** Variant annotation, ACMG classification, API enrichment, case metadata for Electron desktop app
**Milestone:** v0.4.0 — Adding annotation workflows, classifications, live APIs, and case metadata
**Researched:** 2026-01-28
**Overall confidence:** HIGH (all pitfalls sourced from official docs, peer-reviewed publications, or verified against existing codebase)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, security vulnerabilities, or production-breaking failures. These must be addressed before or during the phase they affect.

---

### Pitfall 1: Foreign Keys Not Enabled = Silent Data Corruption

**What goes wrong:**
Adding annotation tables (comments, tags, classifications) with foreign key constraints to `case_id` or `variant_id` appears to work, but deletions leave orphaned annotation records. When users delete a case, variant comments and classifications for that case remain in the database, inflating database size and causing confusing "ghost" annotations.

**Why it happens:**
SQLite disables foreign key enforcement **by default** for backward compatibility. The existing Varlens codebase enables `PRAGMA foreign_keys = ON` in DatabaseService.ts (line 81), but this is **per-connection**. If any new code path opens a database connection without this pragma, orphaned rows will accumulate silently.

**Consequences:**
- Database grows unexpectedly after case deletions
- Query results return annotations for non-existent cases
- Count mismatch between annotations and active cases
- Users see "ghost" comments/tags for deleted variants

**Prevention:**
- Verify `PRAGMA foreign_keys = ON` executes immediately after opening connection, before any schema operations
- Add integration test: delete case with annotations → verify annotation rows cascade delete
- Document in schema comments: "foreign_keys pragma REQUIRED, see DatabaseService.ts"
- Consider adding `CHECK (case_id IS NOT NULL)` constraints as defense-in-depth
- Index foreign keys: `CREATE INDEX idx_comments_variant_id ON variant_comments(variant_id)`

**Warning signs:**
- Database grows unexpectedly after case deletions
- Query results return annotations for non-existent cases
- `SELECT COUNT(*) FROM variant_comments WHERE variant_id NOT IN (SELECT id FROM variants)` returns non-zero

**Phase to address:** Phase 1 (Schema Design) — before creating any annotation tables
**Recovery cost:** MEDIUM — requires scanning all annotation tables and deleting orphaned rows manually

**Source:** [SQLite Foreign Keys](https://sqlite.org/foreignkeys.html), [SQLite Foreign Key Support](https://tangenttechnologies.ca/blog/sqlite-foreign-key/)

---

### Pitfall 2: Ensembl VEP Platform Transition Breaking Changes (2026)

**What goes wrong:**
VEP API response format changes break parsing in production. Ensembl is transitioning to a new platform (beta.ensembl.org) in early 2026, with the current API receiving its **final update at release e!116**. After that, the old API remains available but frozen — no new genome builds, no format updates. A breaking change already occurred: `maf` (minor allele frequency) was renamed to `af` (allele frequency) to match the downloadable VEP tool.

**Why it happens:**
Ensembl is migrating to a new architecture. The old REST API (rest.ensembl.org) will eventually redirect users to the new platform. API response formats may differ. Field names change without semantic versioning. The app assumes response schema stability.

**Consequences:**
- VEP API calls return 200 OK but parsing throws unexpected field errors
- Missing fields in variant details panel after VEP fetch
- Logs show `SyntaxError: Unexpected token` or `Cannot read property 'X' of undefined`
- Users lose access to enrichment data
- Emergency patch required

**Prevention:**
- Use response validation: parse VEP JSON with schema validation (zod, ajv) to detect unexpected formats
- Log schema validation failures with full response body (sanitized) for debugging
- Implement feature flag: `USE_NEW_VEP_API` to toggle between old and new endpoints during transition
- Monitor Ensembl changelog: https://github.com/Ensembl/ensembl-rest/wiki/Change-log
- Cache VEP responses with version/endpoint metadata for debugging after-the-fact
- Build graceful degradation: if parse fails, show raw JSON in details panel instead of crashing
- Subscribe to Ensembl mailing list for API change announcements

**Warning signs:**
- VEP API calls return 200 OK but parsing throws errors
- Missing fields in variant details panel after VEP fetch
- Console shows unexpected field names in responses
- Integration tests start failing without code changes

**Phase to address:** Phase 3 (API Integration) + ongoing monitoring
**Recovery cost:** HIGH — if not caught early, users lose access to enrichment data; requires emergency patch

**Source:** [Ensembl Platform Transition 2026](https://www.ensembl.info/2025/12/02/updates-to-programmatic-access-to-ensembl-and-transitioning-to-the-new-ensembl-platform/), [Ensembl REST Change log](https://github.com/Ensembl/ensembl-rest/wiki/Change-log)

---

### Pitfall 3: VEP Rate Limiting Without Exponential Backoff = Cascade Failures

**What goes wrong:**
User opens side panel for 10 variants rapidly → all 10 VEP requests fire simultaneously → server returns 429 Too Many Requests → app retries all 10 immediately → more 429s → infinite retry loop until user force-quits app.

**Why it happens:**
Ensembl VEP REST API enforces **15 requests/second, 55,000 requests/hour** (averages to 15/sec). When rate limit exceeded:
- **403 Forbidden** = submitting far too many requests
- **429 Too Many Requests** = rate-limited (includes `Retry-After` header in seconds)

Without request queuing and exponential backoff, concurrent requests trigger rate limits, and naive retry logic amplifies the problem.

**Consequences:**
- Network tab shows bursts of 10+ VEP requests in <1 second
- Console logs show repeated 429 errors
- Exponentially growing request queue (memory leak)
- UI becomes unresponsive during VEP fetch storms
- User must force-quit application

**Prevention:**
- Implement request queue: max 10 requests/second (buffer below 15/sec limit)
- Respect `Retry-After` header on 429 responses (mandatory per HTTP spec)
- Use exponential backoff: 1s, 2s, 4s, 8s for retries after 429
- Debounce side panel open: wait 300ms before firing VEP request (user may close panel quickly)
- AbortController: cancel in-flight request when user closes side panel or switches variants
- Show user-visible rate limit state: "Ensembl rate limit reached, retrying in 5s..."
- Maximum retry limit: fail after 3 attempts, show error message

**Warning signs:**
- Network tab shows bursts of many VEP requests in <1 second
- Console logs show repeated 429 errors
- Memory usage grows during enrichment fetching
- UI becomes unresponsive when clicking through variants quickly

**Phase to address:** Phase 3 (API Integration)
**Recovery cost:** HIGH — impacts user trust; requires hotfix to stop retry storms

**Source:** [Ensembl Rate Limits](https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits), [VEP API Issues](https://github.com/Ensembl/ensembl-rest/issues/353)

---

### Pitfall 4: HPO Term Obsoletion = Broken Phenotype Tags

**What goes wrong:**
User adds HPO term "HP:0001234" to a case in 2025. HPO updates in 2026 mark it obsolete with replacement "HP:0005678". User's stored term no longer resolves in API queries, causing "Term not found" errors in phenotype display.

**Why it happens:**
HPO ontology evolves continuously. Terms are deprecated/obsoleted when definitions change or duplicates are merged. Best practice: terms are never deleted (IDs persist), but marked `owl:deprecated = true` with `term replaced by` annotations. However, API queries for obsolete terms may return empty results or error responses.

**Consequences:**
- HPO API returns 404 or empty results for previously valid terms
- Phenotype labels display as "HP:XXXXXXX" (ID only) without human-readable text
- User reports: "Phenotype disappeared from case metadata"
- Loss of phenotype context for case interpretation

**Prevention:**
- Store HPO terms with metadata: `{ hpo_id, label, version, created_at, obsolete }`
- Implement validation on case edit: query HPO API to check if stored term is obsolete
- Show warning UI: "This term is obsolete. Suggested replacement: [new term]"
- Batch validation: background task to check all stored HPO terms against current ontology
- Log HPO version used: store ontology release date for audit trail
- Allow users to manually update obsolete terms (don't auto-replace — may change meaning)
- Cache term metadata locally: reduces API calls, provides offline fallback

**Warning signs:**
- HPO API returns 404 or empty results for previously valid terms
- Phenotype labels display as IDs without human-readable text
- Users report missing phenotypes
- Validation batch job reports obsolete terms

**Phase to address:** Phase 2 (Schema Design) + Phase 4 (Case Metadata UI)
**Recovery cost:** MEDIUM — requires manual review of all stored terms, user intervention to update

**Source:** [HPO Obsoletion](https://github.com/obophenotype/human-phenotype-ontology/wiki/Obsoletion), [Ontology Obsoletion Guide](https://incatools.github.io/ontology-access-kit/guide/obsoletion.html)

---

### Pitfall 5: ACMG Evidence vs. Classification Conflation

**What goes wrong:**
Database schema stores `acmg_classification` as single enum: `{pathogenic, likely_pathogenic, vus, likely_benign, benign}`. User marks variant with PM2 (absent in population DB) and PP3 (computational pathogenic) evidence, expecting VUS. App auto-calculates "Likely Pathogenic" based on rules. Six months later, user learns PM2 should be downweighted to PM2_Supporting per ClinGen 2025 update. All historical classifications are now wrong, but evidence codes weren't stored — only the final label.

**Why it happens:**
ACMG classification is a **rules-based inference** from evidence codes (PS1, PM2, PP3, BS1, BP4, etc.), not a direct property. Storing only the final classification discards:
- Which evidence codes were applied
- Strength of each code (e.g., PM2 vs PM2_Supporting)
- Why conflicting evidence was resolved a certain way
- Whether classification was auto-calculated or user-overridden

**Consequences:**
- Users ask: "Why is this variant classified as X?" — no answer in database
- Classification changes after app update, confusing users
- Cannot reproduce classification decision from 6 months ago
- Conflicting evidence not visible in UI (e.g., BS3_Moderate vs PP3 contradiction)
- Cannot retroactively apply updated ACMG guidelines

**Prevention:**
- **Separate tables:** `variant_acmg_evidence` (many evidence codes per variant) and `variant_acmg_classification` (derived/override)
- Evidence schema: `{ variant_id, case_id, evidence_code, strength, applied_at, applied_by, rationale_text }`
- UI: Show evidence codes with strength badges; allow adding/removing individual codes
- Classification algorithm: re-compute on-demand from evidence table; allow user override with audit log
- Store version: ACMG guidelines version (2015 baseline, ClinGen updates 2020-2025)
- Allow recomputation: "Recalculate all classifications with updated ACMG rules" batch operation
- Timestamp everything: evidence application, classification changes, guideline version

**Warning signs:**
- Schema has only `classification` column, no `evidence_codes` table
- Users ask why variant classified as X, no provenance available
- Classification UI allows picking tier directly without evidence
- Cannot answer "what evidence supports this classification?"

**Phase to address:** Phase 1 (Schema Design) — **MUST GET RIGHT UPFRONT**
**Recovery cost:** **CRITICAL** — requires data migration, re-annotation of all variants; may lose historical context permanently

**Source:** [ACMG Guidelines Overview](https://pmc.ncbi.nlm.nih.gov/articles/PMC6885382/), [ACMG PM2/PP3 Issues](https://help.emg.illumina.com/emedgene-analyze-manual/variant_page/evidence_section/individual-acmg-criteria-evaluation)

---

### Pitfall 6: Race Conditions: User Clicks 5 Variants in 2 Seconds

**What goes wrong:**
User clicks variant A → side panel opens → VEP request fires (500ms latency). User clicks variant B → new side panel opens → VEP request fires. VEP response for A arrives **after** B's response → side panel shows variant B's position but variant A's consequence annotations.

**Why it happens:**
Network requests don't complete in order. Fast user interaction triggers multiple concurrent API calls. Without request cancellation and response tracking, stale responses overwrite fresh data.

**Consequences:**
- Side panel flickers between different variants' data
- Data mismatch: variant position in header doesn't match consequence in body
- User confusion and loss of trust
- Debugging nightmare: race conditions are timing-dependent

**Prevention:**
- **AbortController pattern:** cancel previous VEP request when new variant selected
  ```typescript
  let currentAbortController: AbortController | null = null

  async function fetchVepData(variant) {
    if (currentAbortController) currentAbortController.abort()
    currentAbortController = new AbortController()
    const response = await fetch(url, { signal: currentAbortController.signal })
    // ... parse response
  }
  ```
- Request ID tracking: assign unique ID to each request, discard responses with stale IDs
- Loading state management: show spinner until correct response arrives, don't flash stale data
- Debounce: wait 200ms after variant selection before firing API request (gives user time to skip through)
- Clear previous data immediately when new variant selected

**Warning signs:**
- Side panel flickers between different variants' data
- Console shows "Request aborted" warnings (good sign if implemented!)
- Data mismatch between header and body
- Users report seeing wrong data briefly

**Phase to address:** Phase 3 (API Integration)
**Recovery cost:** LOW — cosmetic bug, but confusing UX; easy to fix with AbortController

**Source:** [Handling API Race Conditions in React](https://sebastienlorber.com/handling-api-request-race-conditions-in-react), [AbortController for Race Conditions](https://www.cloudthat.com/resources/blog/safeguarding-network-requests-for-handling-race-conditions-with-abortcontroller)

---

### Pitfall 7: Schema Migration on Encrypted DB Without Testing

**What goes wrong:**
Adding new tables (`variant_comments`, `variant_tags`) works in dev (unencrypted :memory: DB). Deploy to production → migration fails on encrypted database with cryptic error: "file is not a database" or "database disk image is malformed". Migration partially completes → database corrupted → user loses all data.

**Why it happens:**
SQLCipher-encrypted databases have different failure modes than plain SQLite:
- Wrong password → "file is not a database" error
- Schema migration runs before `PRAGMA key` → reads encrypted bytes as corrupted plain SQLite
- ALTER TABLE on encrypted DB without WAL mode → locking issues

Existing Varlens code correctly sets `PRAGMA key` **first** (DatabaseService.ts line 74), but new migration code paths might bypass this.

**Consequences:**
- Migration succeeds in CI (Node.js tests use :memory:) but fails in packaged Electron app
- Error: "file is not a database" during schema upgrade
- Database becomes unusable after version update
- User data loss without backup

**Prevention:**
- Test all schema migrations on **encrypted** test database (not just :memory:)
- Migration test fixture: create encrypted .db file, run migration, verify schema
- Backup before migration: copy .db file to .db.backup before ALTER TABLE
- Atomic migrations: wrap in transaction, rollback on error
- Validate encryption after migration: `PRAGMA cipher_integrity_check`
- Document: "All schema changes must test with encrypted DB"
- Integration test: encrypted DB with v0.3.0 schema → run migration → verify v0.4.0 schema

**Warning signs:**
- Migration succeeds in CI but fails in packaged app
- Users report "file is not a database" after update
- Database corruption after version upgrade
- Cannot open previously working databases

**Phase to address:** Phase 1 (Schema Design) — before any new tables
**Recovery cost:** **CRITICAL** — data loss; requires restore from backup (if user has one)

**Source:** [SQLite3 Multiple Ciphers Docs](https://utelle.github.io/SQLite3MultipleCiphers/), [SQLite Encryption Best Practices](https://dev.to/stephenc222/basic-security-practices-for-sqlite-safeguarding-your-data-23lh)

---

### Pitfall 8: Offline Detection False Positives

**What goes wrong:**
App uses `navigator.onLine` to detect offline state. Developer's laptop has VirtualBox running with Host-Only Network adapter → `navigator.onLine` returns true → app attempts VEP API call → hangs for 30 seconds → timeout error → "Failed to load variant details" (but internet was available).

**Why it happens:**
`navigator.onLine` only detects network interface state, not actual internet connectivity. Returns true if:
- Any network adapter is "connected" (even virtual adapters)
- Computer is on LAN without internet gateway
- Captive portal blocks external requests

Electron's `net.isOnline()` has same limitations. False positives are common.

**Consequences:**
- Users report: "App says I'm online but enrichment doesn't work"
- VEP requests timeout frequently despite working internet
- App becomes unresponsive for 30s when opening side panel
- Poor user experience during demos/presentations

**Prevention:**
- Implement real connectivity check: lightweight ping to Ensembl status endpoint or example.com
- Cache connectivity status: check every 30 seconds, not per-request
- Timeout aggressively: 5-10 second timeout for VEP requests (not 30s default)
- Graceful degradation UI: if VEP fails, show "Offline or API unavailable" + cached data
- Don't block UI: show offline banner, but allow browsing cached variants
- User override: "Force offline mode" setting for presentations/demos
- Show connectivity indicator in UI: green/yellow/red dot with tooltip

**Warning signs:**
- Users report online status mismatch
- VEP requests timeout despite working internet
- Long pauses when opening side panel
- Virtual network adapters causing false positives

**Phase to address:** Phase 3 (API Integration) — before VEP fetch implementation
**Recovery cost:** LOW — UX annoyance, easily fixed with better detection logic

**Source:** [Electron Online/Offline Detection](https://www.electronjs.org/docs/latest/tutorial/online-offline-events), [navigator.onLine Limitations](https://github.com/electron/electron/issues/6633)

---

### Pitfall 9: Case-Insensitive Tag Duplicates

**What goes wrong:**
User adds tag "Candidate" to variant 1. Later adds tag "candidate" to variant 2. Tag list shows both "Candidate" and "candidate". Tag filter dropdown shows duplicates. Clicking "Candidate" filter finds only variants tagged exactly "Candidate", missing those tagged "candidate".

**Why it happens:**
SQLite text comparisons are case-sensitive by default (unless using COLLATE NOCASE). User-generated tags proliferate with slight case variations: "JavaScript", "Javascript", "javascript", "JAVASCRIPT".

**Consequences:**
- Tag dropdown shows "candidate", "Candidate", "CANDIDATE" as separate entries
- Tag search returns incomplete results
- Tag count doesn't match user's expectation (hidden duplicates)
- Database clutter with near-duplicates

**Prevention:**
- Normalize tags at input: lowercase all tags before storing (consistent casing)
- Alternative: store `tag_normalized` (lowercase) and `tag_display` (user's original case)
- Schema: `CREATE UNIQUE INDEX idx_tag_normalized ON tags(LOWER(tag_name))`
- UI: autocomplete suggests existing tags case-insensitively ("cand..." shows "Candidate")
- Migration: deduplicate existing tags with LOWER() GROUP BY, preserve most recent casing
- Validation: reject tag creation if normalized version exists

**Warning signs:**
- Tag dropdown shows case variations as separate entries
- Tag search returns incomplete results
- User confusion about "duplicate" tags
- Database query shows multiple rows for similar tag names

**Phase to address:** Phase 2 (Schema Design) — before tags table creation
**Recovery cost:** MEDIUM — requires data migration to deduplicate tags, may lose user's preferred casing

**Source:** [Tag Case Sensitivity Issues](https://github.com/shaarli/Shaarli/issues/146), [Tags Case Sensitivity Discussion](https://github.com/11ty/eleventy/discussions/1461)

---

### Pitfall 10: Renderer Process API Key Exposure

**What goes wrong:**
Developer stores VEP API key in renderer process (Vuex/Pinia store) for convenience. User opens DevTools (Ctrl+Shift+I) → inspects Vuex state → copies API key → uses it for their own projects → quota exhausted → production app stops working.

**Why it happens:**
Electron renderer process runs Chromium with DevTools enabled (even in production builds unless explicitly disabled). All renderer JavaScript state is inspectable. Storing secrets in renderer = exposing them to users.

**Consequences:**
- API keys visible in Vuex/Pinia DevTools inspector
- API keys in renderer bundle.js (visible via source maps)
- User reports: "I found this key in your app, is it supposed to be there?"
- Quota abuse from leaked keys
- Must rotate keys and update all installations

**Prevention:**
- **NEVER store API keys in renderer process** — even encrypted (encryption key would be in JS)
- Store API keys in main process: use Electron's `safeStorage` API for OS-level credential storage
- IPC pattern: renderer requests enrichment via `api.enrichment.fetchVep(variant)` → main process fetches with stored key → returns sanitized result
- Environment variables: API keys in .env file, loaded in main process only (never bundled by Vite)
- Document: "Renderer process is untrusted. All secrets in main process only."
- Disable DevTools in production: `webPreferences: { devTools: false }` (but impacts debugging)

**Warning signs:**
- API keys visible in Vuex/Pinia DevTools inspector
- API keys in renderer bundle.js (grep for key patterns)
- Source maps expose key values
- User reports finding keys in app

**Phase to address:** Phase 0 (Architecture) — before any API integration
**Recovery cost:** **CRITICAL** — if key leaks, must rotate key, update all installations; potential quota abuse

**Source:** [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)

---

## Moderate Pitfalls

Mistakes that cause delays, rework, or degraded user experience. These should be addressed during the phase but are recoverable.

---

### Pitfall 11: Embedding Variant Data in Annotation Records

**What goes wrong:**
Store full variant data in comment/tag records: `{ comment_id, variant_json: {...}, comment_text }`. When variant annotations update, denormalized copies are stale. User sees outdated gnomAD AF in comment context.

**Why it happens:**
Developers want to show variant context with annotations (chr:pos, gene) and think copying variant data is simpler than joining tables.

**Consequences:**
- Database bloat: variant data duplicated in every annotation
- Stale data: variant updates don't propagate to annotations
- Maintenance burden: must update all annotation copies when variant changes
- Query complexity: cannot easily filter by variant properties across annotations

**Prevention:**
- Store only `variant_id` foreign key in annotation tables
- Join with variants table for display: `SELECT comments.*, variants.* FROM comments JOIN variants ON comments.variant_id = variants.id`
- Cache frequently accessed variant data in memory (Vue computed, not database)

**Phase to address:** Phase 1 (Schema Design)
**Recovery cost:** MEDIUM — requires schema refactoring, data migration

---

### Pitfall 12: Global Comments Without Per-Case Context

**What goes wrong:**
One comment table for all cases. User adds "Likely pathogenic" comment globally → comment appears in all cases, even those with different zygosity/context.

**Why it happens:**
Context collapse. Variant interpretation depends on case context (phenotype, family history, zygosity). Same variant may be pathogenic in one case, benign in another.

**Consequences:**
- Comments show in wrong context
- User confusion: "Why does this case have that comment?"
- Cannot distinguish global notes from case-specific interpretation
- Loss of case-specific context

**Prevention:**
- Separate `global_comments` (variant-level) and `case_comments` (variant + case)
- Schema: `case_comments { variant_id, case_id, comment_text }`, `global_comments { variant_id, comment_text }`
- UI shows both, clearly labeled: "Global notes" section + "Case-specific notes" section
- Allow converting global comment to case-specific and vice versa

**Phase to address:** Phase 2 (Annotation Data Models)
**Recovery cost:** LOW — schema extension, UI update, no data loss

---

### Pitfall 13: No Timestamp on Classification Changes

**What goes wrong:**
Classification stored as single value: `acmg_classification = 'pathogenic'`. No history. User changes classification → previous value lost forever. Cannot answer "When did this classification change?" or "Who changed it?".

**Why it happens:**
Developers focus on current state, forget audit trail requirements. UPDATE statements overwrite previous values without history.

**Consequences:**
- Cannot answer temporal questions: "When did we classify this as pathogenic?"
- Cannot answer provenance questions: "Who made this classification?"
- Cannot revert accidental changes
- Loss of classification evolution context
- Compliance issues: some clinical labs require audit trails

**Prevention:**
- Append-only audit log: `classification_history` table with `{variant_id, classification, evidence_codes, timestamp, user_id, notes}`
- Never UPDATE classification — always INSERT new row
- Current classification = most recent row in history table
- UI shows classification timeline: "VUS (2025-01-01) → Likely Pathogenic (2025-06-15) → Pathogenic (2026-01-20)"
- Allow reverting to previous classification

**Phase to address:** Phase 2 (Annotation Data Models)
**Recovery cost:** MEDIUM — requires schema redesign, migration if classifications already exist

---

### Pitfall 14: Blocking UI During API Calls

**What goes wrong:**
Side panel freezes while VEP request in flight (no loading state). User thinks app crashed. Clicks repeatedly → multiple requests → rate limit hit.

**Why it happens:**
Developers forget to show loading state, assume API is fast enough to not need it. Network variability means requests can take 0.1s to 10s.

**Consequences:**
- User thinks app crashed
- Multiple redundant requests (rate limiting)
- Poor perceived performance even when actual response time is good
- User frustration

**Prevention:**
- Immediate loading state (skeleton screen) when side panel opens
- Show "Loading enrichment data..." message
- Debounce clicks: ignore rapid clicking during loading
- Show timeout countdown: "Loading... (5s remaining)"
- Graceful timeout: show error after 10s with retry button
- Cancel button: allow user to abort slow requests

**Phase to address:** Phase 4 (Side Panel UI)
**Recovery cost:** LOW — UI polish, no data model changes

---

### Pitfall 15: N+1 Query Pattern in Side Panel

**What goes wrong:**
Side panel shows variant + 10 external links. Each link requires extracting IDs from variant JSON fields:
```typescript
for (const variant of selectedVariants) {
  const gene = await db.prepare('SELECT gene_symbol FROM variants WHERE id = ?').get(variant.id)
  const clinvar = await db.prepare('SELECT clinvar FROM variants WHERE id = ?').get(variant.id)
  // ... 10 more queries
}
```

**Consequences:**
- 12 queries per variant
- Opening side panel for 5 variants = 60 queries (slow)
- Database bottleneck
- UI lag

**Prevention:**
- Single query with all fields: `SELECT id, gene_symbol, clinvar, ... FROM variants WHERE id IN (?, ?, ?, ?, ?)`
- Fetch complete variant object once, destructure needed fields
- Cache variant data: don't re-query on every side panel render

**Phase to address:** Phase 4 (Side Panel UI)
**Recovery cost:** LOW — query optimization, no schema changes

---

### Pitfall 16: Rendering 1000 HPO Terms in Autocomplete Dropdown

**What goes wrong:**
HPO API returns 1000 matching terms for query "syndrome". Rendering all in dropdown → UI freezes for 2 seconds.

**Why it happens:**
Vuetify v-autocomplete doesn't virtualize by default. DOM node count explodes. Browser struggles to render and handle scroll.

**Consequences:**
- UI freezes during HPO search
- Poor user experience
- Browser memory spikes
- Slow typing response

**Prevention:**
- Limit results: show first 50 terms + "... 950 more, refine search" message
- Use virtual scrolling (v-virtual-scroll) for large lists
- Debounce search input: wait 300ms after typing before querying API
- Show "Too many results, please refine search" when count > 100
- Progressive loading: show first 50, load more on scroll

**Phase to address:** Phase 4 (Case Metadata UI)
**Recovery cost:** LOW — UI optimization, no data model changes

---

### Pitfall 17: Recomputing ACMG Classification on Every Render

**What goes wrong:**
Variant table row component computes ACMG badge color from evidence codes in render function → recomputes 100 times per pagination load.

**Why it happens:**
Classification algorithm runs in hot path (O(n) per row). Wasted CPU on repeated computation of unchanging data.

**Consequences:**
- Slow table rendering
- UI lag during pagination
- Unnecessary CPU usage
- Poor performance with large result sets

**Prevention:**
- Compute once in database query: `SELECT variant.*, calculate_acmg(variant_id) as acmg_classification FROM variants`
- Or memoize with Vue computed property: cache result until evidence codes change
- Or precompute during evidence insertion: update classification immediately when evidence changes
- Store computed classification in database (with timestamp for cache invalidation)

**Phase to address:** Phase 5 (Performance Optimization)
**Recovery cost:** LOW — optimization, no schema changes needed

---

### Pitfall 18: Integration with Existing External Links

**What goes wrong:**
Existing system has external links to ClinVar, gnomAD, OMIM via shell.openExternal with HTTPS-only + domain allowlist (shell.ts). New VEP enrichment adds links to Ensembl, HPO website. Developers forget to update allowlist → links in side panel fail silently.

**Why it happens:**
Allowlist is in separate file (src/main/ipc/handlers/shell.ts). New features add link sources without updating security configuration.

**Consequences:**
- "View in Ensembl" links fail with "Domain not allowed" error
- HPO phenotype links don't open
- User confusion
- Incomplete feature delivery

**Prevention:**
- Document allowlist update in roadmap: "Phase 3: Add ensembl.org, hpo.jax.org to shell.ts allowlist"
- Add test: verify all API domains in allowlist before integration phase completes
- Code review checklist: "Did you update shell.ts allowlist?"
- Consider dynamic allowlist: load from config file, allow user additions

**Phase to address:** Phase 3 (API Integration) — before VEP/HPO links
**Recovery cost:** LOW — one-line config change, but easily forgotten

---

## Minor Pitfalls

Mistakes that cause annoyance or minor technical debt. Addressable during implementation without major rework.

---

### Pitfall 19: CORS Doesn't Apply in Main Process (Developer Confusion)

**What goes wrong:**
VEP API calls from main process work fine. Developer tries debugging from renderer process console → CORS errors appear → confusion about why "API doesn't work".

**Why it happens:**
CORS is a browser security feature. Main process is Node.js, no CORS restrictions. Renderer process is Chromium, enforces CORS. Developers forget this distinction.

**Consequences:**
- Developer confusion during debugging
- Time wasted investigating "CORS issues" that don't exist in production
- Temptation to disable CORS (bad security practice)

**Prevention:**
- Document: "All HTTP requests in main process via IPC handlers, never in renderer"
- Enforce IPC pattern in code review
- Add linting rule: warn on fetch/axios in renderer code
- Comment in code: "// Renderer process: CORS applies. Always use IPC for API calls."

**Phase to address:** Phase 0 (Architecture) — documentation/convention
**Recovery cost:** NONE — developer education, no code changes needed

**Source:** [Electron CORS in Main Process](https://m-t-a.medium.com/avoiding-cors-in-electron-sending-requests-through-ipc-28ad9407aac0), [CORS Errors 2026](https://medium.com/engineering-playbook/cors-errors-killed-our-launch-heres-what-i-wish-i-knew-7c84da40f91b)

---

### Pitfall 20: FTS5 Doesn't Index New Annotation Tables Automatically

**What goes wrong:**
New tables (`variant_comments`, `variant_tags`) need text search. Developer forgets to add FTS5 index → tag/comment search doesn't work.

**Why it happens:**
Existing FTS5 table (`variants_fts`) only indexes variants table. FTS5 indexes must be created explicitly per table.

**Consequences:**
- Tag search returns no results
- Comment search doesn't work
- Users expect search to work, confusion when it doesn't
- Feature feels incomplete

**Prevention:**
- Checklist in Phase 1: "Does this text column need FTS? Add to schema.ts createFTSTable."
- Create separate FTS tables: `variant_comments_fts`, `variant_tags_fts`
- Add FTS triggers for INSERT/UPDATE/DELETE on annotation tables
- Test: insert comment with text, search for that text, verify result returned

**Phase to address:** Phase 1 (Schema Design) — during table creation
**Recovery cost:** LOW — add FTS table and triggers, no data loss

---

### Pitfall 21: Side Panel Obscures Selected Variant Row

**What goes wrong:**
User selects variant row 50 in table → side panel opens on right → scrolls row 50 out of view → user forgets which variant selected.

**Why it happens:**
Contextual disorientation. Side panel takes screen space, table reflows, scroll position changes.

**Consequences:**
- User loses context of which variant they're viewing
- Closes panel → "Wait, which variant was I looking at?"
- Must re-scan table to find selected row
- Poor UX for deep analysis workflows

**Prevention:**
- Sticky header in table highlights selected row even when scrolled
- Side panel header shows variant ID + position (chr:pos) for context
- "Jump back to variant" button scrolls table to selected row
- Consider slide-over panel instead of push (doesn't reflow table)
- Highlight selected row with distinct color, keep in viewport

**Phase to address:** Phase 4 (Side Panel UI)
**Recovery cost:** LOW — UI polish, UX improvement

---

### Pitfall 22: No Undo for ACMG Classification

**What goes wrong:**
User adds PM2 evidence code by mistake → classification changes to Likely Pathogenic → clicks away → realizes mistake → no undo button.

**Why it happens:**
Developers implement save/apply but forget undo/cancel. Permanent data changes without confirmation.

**Consequences:**
- User frustration
- Must manually remove wrong evidence code
- Loss of trust in app
- Requires re-entering correct evidence

**Prevention:**
- Confirmation dialog before applying ACMG changes: "Add PM2 evidence? This will change classification to Likely Pathogenic. [Cancel] [Apply]"
- Undo stack: last 10 classification actions stored in memory, "Undo" button in side panel
- Audit log shows full history: revert to previous classification from log view
- Cancel button: discard unsaved evidence changes

**Phase to address:** Phase 5 (UX Polish)
**Recovery cost:** LOW — UI feature, no data model changes

---

### Pitfall 23: Loading State: "Loading..." vs "Offline"

**What goes wrong:**
VEP request times out → shows generic "Loading..." spinner forever.

**Why it happens:**
Developers implement loading state but forget error/offline states. Single loading indicator for all failure modes.

**Consequences:**
- User doesn't know if app is frozen, API is down, or network is offline
- Must guess whether to wait or close app
- Poor UX clarity

**Prevention:**
- Timeout after 10 seconds → "Failed to load enrichment data. [Retry] [View offline version]"
- Detect offline: show "Offline – showing cached data only" banner
- Distinguish errors: "Ensembl API rate limited (retry in 5s)" vs "Network error" vs "Invalid response"
- Use specific error messages based on HTTP status codes

**Phase to address:** Phase 4 (Side Panel UI)
**Recovery cost:** LOW — UI polish, error handling improvement

---

### Pitfall 24: Tag Color Coding Without Accessibility

**What goes wrong:**
Tags colored by type: red = pathogenic, green = benign, blue = custom. Colorblind users can't distinguish.

**Why it happens:**
8% of male users have red-green colorblindness. Developers test with normal color vision only.

**Consequences:**
- Colorblind users cannot distinguish tag types
- Violates WCAG accessibility guidelines
- Poor user experience for accessibility

**Prevention:**
- Icons + color: red X icon for pathogenic, green check for benign
- Text prefix: "[P] Pathogenic" not just red background
- WCAG contrast: ensure 4.5:1 contrast ratio for text on colored backgrounds
- Test with colorblind simulators (browser extensions)
- Provide high-contrast mode option

**Phase to address:** Phase 5 (UX Polish)
**Recovery cost:** LOW — UI styling, accessibility improvement

---

### Pitfall 25: SQL Injection via Custom Tag Names

**What goes wrong:**
User-entered tag name inserted into dynamic SQL:
```typescript
db.exec(`INSERT INTO tags (name) VALUES ('${userInput}')`)
```

User input: `'); DROP TABLE variants; --` executes malicious SQL.

**Why it happens:**
Developer forgets parameterized queries. Uses string interpolation for convenience.

**Consequences:**
- SQL injection vulnerability
- Potential data loss (DROP TABLE)
- Security breach

**Prevention:**
- Use parameterized queries ALWAYS: `db.prepare('INSERT INTO tags (name) VALUES (?)').run(userInput)`
- Never use string interpolation for SQL values
- Existing Varlens code uses prepared statements correctly — maintain this pattern
- Code review: flag any string interpolation in SQL

**Phase to address:** Phase 0 (Security) — all SQL must use parameterized queries
**Recovery cost:** CRITICAL — security vulnerability, requires immediate fix

---

### Pitfall 26: HPO API Response Injection

**What goes wrong:**
HPO API returns term labels with HTML entities: `"Microcephaly <i>(small head)</i>"`. Rendering in Vue template without sanitization → XSS if API compromised.

**Why it happens:**
Trust external API responses. Assume API data is safe. Render with v-html without sanitization.

**Consequences:**
- XSS vulnerability if API compromised
- Attacker controls HPO API → injects `<script>` tags → steals data
- Security breach

**Prevention:**
- Sanitize all API responses: strip HTML tags or use DOMPurify
- Render with Vue's text interpolation (`{{ label }}`) not v-html
- If HTML needed, use DOMPurify: `v-html="sanitize(label)"`
- Never trust external API data

**Phase to address:** Phase 3 (API Integration) — all API response rendering
**Recovery cost:** LOW — add sanitization layer, minimal code changes

---

## "Looks Done But Isn't" Checklist

Features that appear complete in demo but break in production:

- [ ] **VEP timeout handling:** Works on fast network, hangs on slow hotel WiFi → add 5-10s timeout
- [ ] **HPO term search with unicode:** Works for English terms, fails on "café" or "naïve" → ensure FTS5 tokenizer handles diacritics
- [ ] **ACMG conflicting evidence:** UI shows PM2 + BP4, but classification algorithm doesn't resolve conflict → implement conflict resolution rules
- [ ] **Case deletion with 1000 variants:** Works with 10 variants, freezes with 1000 (FK cascade delete slow) → add loading dialog
- [ ] **Tag autocomplete with 500 tags:** Works with 10 tags, dropdown unresponsive with 500 → limit results or virtualize
- [ ] **Offline → online transition:** App goes offline → shows cached data. Goes back online → doesn't retry failed VEP requests → add "Refresh enrichment" button
- [ ] **Multi-user tag conflicts (future):** Single-user works. Multiple users editing same DB → last write wins, no conflict resolution → document single-user constraint
- [ ] **ACMG version migration:** Works with 2015 rules. ClinGen publishes 2027 update → no way to toggle versions → add version selector

---

## Recovery Strategies

### If VEP API Changes Break Production

1. **Immediate:** Disable VEP enrichment via feature flag (add to config.json)
2. **Hotfix:** Update response parser to handle new format + old format (backward compatible)
3. **Validation:** Add integration test that fetches real VEP API response and validates schema
4. **Prevention:** Subscribe to Ensembl mailing list for API change announcements

### If Foreign Keys Weren't Enabled

1. **Detect:** Run query: `SELECT COUNT(*) FROM variant_comments WHERE variant_id NOT IN (SELECT id FROM variants)`
2. **Backup:** `cp database.db database.db.before-cleanup`
3. **Clean:** `DELETE FROM variant_comments WHERE variant_id NOT IN (SELECT id FROM variants)`
4. **Enable:** Verify `PRAGMA foreign_keys` returns `1`
5. **Test:** Delete test case, verify annotations cascade delete

### If Encrypted DB Migration Fails

1. **Don't panic:** Database is likely intact, migration just didn't complete
2. **Backup:** Copy .db file before any recovery attempts
3. **Verify encryption:** `sqlite3 database.db "PRAGMA cipher_version"` — if fails, encryption corrupted
4. **Rollback migration:** Restore from backup, run app with old schema version
5. **Test migration:** Create encrypted test DB, run migration script manually, verify with `PRAGMA integrity_check`
6. **Retry:** Deploy fixed migration, test on backup copy first

### If HPO Terms Become Obsolete

1. **Detect:** Background job queries stored HPO IDs against API, logs obsolete terms
2. **Notify:** Show warning banner: "X cases have obsolete HPO terms. [Review]"
3. **Manual review:** Provide UI to review obsolete terms, suggest replacements, allow bulk update
4. **Document:** "Reviewed obsolete HPO terms on [date]" audit log entry

---

## Pitfall-to-Phase Mapping

| Phase | Critical Pitfalls to Address |
|-------|------------------------------|
| **Phase 0: Architecture** | #10 (API key security), #19 (IPC pattern) |
| **Phase 1: Schema Design** | #1 (Foreign keys), #5 (ACMG data model), #7 (Encrypted migration), #9 (Tag normalization), #11 (Denormalization), #20 (FTS5) |
| **Phase 2: Annotation Data Models** | #4 (HPO obsoletion), #12 (Global vs case comments), #13 (Timestamp audit) |
| **Phase 3: API Integration** | #2 (VEP breaking changes), #3 (Rate limiting), #6 (Race conditions), #8 (Offline detection), #18 (Allowlist update), #26 (Response sanitization) |
| **Phase 4: Side Panel UI** | #14 (Loading states), #15 (N+1 queries), #21 (Panel obscures row), #23 (Error messages) |
| **Phase 5: Case Metadata UI** | #16 (HPO autocomplete performance), #24 (Accessibility) |
| **Phase 6: UX Polish** | #17 (Recomputation), #22 (Undo), #24 (Color coding) |
| **Ongoing** | Monitor Ensembl changelog, HPO updates, security advisories |

---

## Key Takeaways

1. **Foreign keys OFF by default = highest-risk pitfall.** Test with encrypted DB immediately.
2. **Ensembl VEP platform transition = production-breaking change in 2026.** Monitor changelog, validate responses.
3. **ACMG data model = get it right upfront.** Evidence codes ≠ classification. Store separately.
4. **Race conditions = inevitable with fast user interactions.** Use AbortController + request IDs.
5. **Offline detection = unreliable.** Implement real connectivity checks, graceful degradation.
6. **API keys in renderer = security breach.** Main process only, use safeStorage.
7. **HPO terms evolve = stored IDs can become obsolete.** Validate periodically, show warnings.
8. **Schema migrations on encrypted DB = different failure modes.** Test with encryption enabled.
9. **Tag normalization = prevent duplicate chaos.** Lowercase + unique index from day 1.
10. **UX polish = loading states, undo, accessibility.** "Looks done" ≠ production-ready.

---

## Sources

### API Reliability & Rate Limits
- [Ensembl REST API Rate Limits](https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits) — PRIMARY
- [Ensembl Platform Transition 2026](https://www.ensembl.info/2025/12/02/updates-to-programmatic-access-to-ensembl-and-transitioning-to-the-new-ensembl-platform/) — PRIMARY
- [Ensembl REST Change Log](https://github.com/Ensembl/ensembl-rest/wiki/Change-log) — PRIMARY
- [VEP API Issues](https://github.com/Ensembl/ensembl-rest/issues/353) — SECONDARY
- [HPO API Documentation](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html) — PRIMARY

### ACMG Classification
- [ACMG Guidelines 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) — PRIMARY
- [ACMG Guidelines Specifications](https://pmc.ncbi.nlm.nih.gov/articles/PMC6885382/) — PRIMARY
- [ACMG PM2/PP3 Interpretation Issues](https://help.emg.illumina.com/emedgene-analyze-manual/variant_page/evidence_section/individual-acmg-criteria-evaluation) — PRIMARY
- [ACMG Evidence Criteria](https://www.acgs.uk.com/media/11631/uk-practice-guidelines-for-variant-classification-v4-01-2020.pdf) — SECONDARY

### Database & Schema Migration
- [SQLite Foreign Keys](https://sqlite.org/foreignkeys.html) — PRIMARY
- [SQLite Foreign Key Support](https://tangenttechnologies.ca/blog/sqlite-foreign-key/) — PRIMARY
- [SQLite3 Multiple Ciphers](https://utelle.github.io/SQLite3MultipleCiphers/) — PRIMARY
- [SQLite Encryption Best Practices](https://dev.to/stephenc222/basic-security-practices-for-sqlite-safeguarding-your-data-23lh) — SECONDARY
- [SQLite Versioning and Migration](https://www.sqliteforum.com/p/sqlite-versioning-and-migration-strategies) — SECONDARY

### Electron Security & IPC
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) — PRIMARY
- [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security) — PRIMARY
- [Electron CORS in Main Process](https://m-t-a.medium.com/avoiding-cors-in-electron-sending-requests-through-ipc-28ad9407aac0) — SECONDARY
- [CORS Errors and Common Mistakes (2026)](https://medium.com/engineering-playbook/cors-errors-killed-our-launch-heres-what-i-wish-i-knew-7c84da40f91b) — SECONDARY

### Offline Detection & Network Status
- [Electron Online/Offline Events](https://www.electronjs.org/docs/latest/tutorial/online-offline-events) — PRIMARY
- [navigator.onLine Limitations](https://github.com/electron/electron/issues/6633) — SECONDARY
- [net.isOnline() Documentation](https://github.com/electron/electron/issues/48561) — SECONDARY

### Race Conditions & API Request Management
- [Handling API Race Conditions in React](https://sebastienlorber.com/handling-api-request-race-conditions-in-react) — PRIMARY
- [AbortController for Race Conditions](https://www.cloudthat.com/resources/blog/safeguarding-network-requests-for-handling-race-conditions-with-abortcontroller) — PRIMARY
- [React Router Race Conditions](https://reactrouter.com/explanation/race-conditions) — SECONDARY

### HPO Ontology Management
- [HPO Obsoletion Guidelines](https://github.com/obophenotype/human-phenotype-ontology/wiki/Obsoletion) — PRIMARY
- [Ontology Obsoletion Best Practices](https://incatools.github.io/ontology-access-kit/guide/obsoletion.html) — PRIMARY
- [HPO Expansion 2019](https://academic.oup.com/nar/article/47/D1/D1018/5198478) — SECONDARY

### Tag Management & Normalization
- [Tag Case Sensitivity Issues](https://github.com/shaarli/Shaarli/issues/146) — SECONDARY
- [Tags Case Sensitivity Discussion](https://github.com/11ty/eleventy/discussions/1461) — SECONDARY
- [Duplicate Tag Keys](https://github.com/aws/aws-cdk/issues/26253) — SECONDARY

### Performance & Annotation Tools
- [Variant Annotation Performance Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC9577137/) — SECONDARY
- [Ultrafast Variant Annotation (VarNote)](https://genome.cshlp.org/content/30/12/1789.full) — SECONDARY
- [vcfanno Performance](https://genomebiology.biomedcentral.com/articles/10.1186/s13059-016-0973-5) — SECONDARY

---

**Confidence Assessment:** HIGH

All critical pitfalls sourced from:
- Official documentation (Ensembl, HPO, SQLite, Electron) — PRIMARY sources
- Peer-reviewed publications (ACMG guidelines) — PRIMARY sources
- Real-world issue reports (GitHub issues) — SECONDARY verification
- Existing Varlens codebase analysis (schema.ts, DatabaseService.ts, shell.ts) — PRIMARY verification

**Limitations:**
- VEP API format changes beyond 2026 e!116 not documented yet (MEDIUM confidence on future specifics)
- HPO API rate limits not officially published (MEDIUM confidence based on NLM service patterns)
- Performance benchmarks for 50+ cases not measured (noted in PROJECT.md as known gap)

**Recommended Next Steps:**
1. Create integration test suite for encrypted database migrations (Phase 1)
2. Subscribe to Ensembl API mailing list for change notifications (Phase 3)
3. Build VEP response schema validator with zod (Phase 3)
4. Document IPC pattern enforcement in code review checklist (Phase 0)
5. Set up HPO term validation background job (Phase 2)
