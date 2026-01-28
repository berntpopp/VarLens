# Technology Stack: Variant Annotation & Classification

**Project:** Varlens
**Researched:** 2026-01-28
**Scope:** Stack additions for variant annotation, ACMG classification, VEP/HPO API integration, case metadata
**Confidence:** HIGH

## Executive Summary

For the new variant annotation, classification, and case metadata features, minimal new dependencies are required. The existing Electron + SQLite stack handles all storage requirements. Add axios for HTTP client (VEP, HPO APIs), leverage existing URL template system for external link-outs, and use native SQLite features (JSON functions, timestamps) for annotation storage. No specialized npm packages needed for ACMG classification (simple 5-tier enum) or HPO handling (API-based autocomplete).

**Total new runtime dependencies: 1** (axios)

## Recommended Stack Additions

### HTTP Client: axios

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `axios` | 1.13.3+ | HTTP client for Ensembl VEP and HPO APIs | **RECOMMENDED over native fetch**: Better error handling (throws for 4xx/5xx), automatic JSON parsing, request/response interceptors for rate limiting, clean syntax. Works perfectly in Electron main process. Native fetch viable but requires more boilerplate for equivalent functionality. Mature ecosystem (167,351 dependent projects). |

**Confidence:** HIGH -- verified current version 1.13.3 (latest stable), fully compatible with Electron 40's Node.js 20.x runtime.

**Installation:**
```bash
npm install axios
```

**Integration Point:** Create new service `src/main/services/HttpService.ts` with axios instance configured for VEP and HPO API calls.

### Core Technologies (Existing - No Changes)

| Technology | Version | Purpose | Notes |
|------------|---------|---------|-------|
| Electron | 40 | Desktop app framework | Already validated (v0.3.0) |
| better-sqlite3-multiple-ciphers | 12.6.2+ | SQLCipher-encrypted SQLite | Already validated (v0.3.0) |
| Vue 3 + Vuetify 3 | Current | Renderer UI framework | Already validated |
| TypeScript | Current | Type safety | Already validated |
| adm-zip | Current | ZIP extraction | Already validated (v0.3.0) for non-password-protected ZIPs |

## What NOT to Add

| Library/Approach | Why Not |
|------------------|---------|
| `node-fetch` | Native fetch in Node.js 18+ makes this unnecessary; axios has better DX for rate limiting and error handling |
| ACMG npm packages | No mature npm packages exist (InterVar, MAGI-ACMG are Python/R tools, not npm); ACMG 5-tier is simple enum (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign) |
| HPO npm packages | `hpo-js` (4 years old, React-specific) not needed; use HPO API directly via axios |
| Specialized annotation libraries | VEP provides comprehensive annotations via REST API; no local processing needed |
| VEP local install | VEP Perl scripts require cache download (60GB+), Perl dependencies; REST API is simpler for desktop app |
| HTTP client for external links | External links open in browser via `shell.openExternal()`. No need to fetch data from PubTator/LitVar/UCSC/etc. |

---

## API Integrations

### Ensembl VEP REST API

**Purpose:** Fetch variant consequence predictions, pathogenicity scores (CADD, REVEL, SpliceAI), transcript effects, protein domain impacts

**Base URL:** `https://rest.ensembl.org`

**Endpoints:**

| Method | Endpoint | Use Case | Example |
|--------|----------|----------|---------|
| GET | `/vep/human/hgvs/:hgvs_notation` | Single variant by HGVS | `/vep/human/hgvs/ENST00000366667:c.803C>T?content-type=application/json` |
| POST | `/vep/human/hgvs` | Multiple variants (batch) | Body: `{ "hgvs_notations": ["ENST00000366667:c.803C>T", ...] }` |
| GET | `/vep/human/region/:region/:allele/` | Single variant by genomic coords | `/vep/human/region/9:22125504-22125504:1/C?content-type=application/json` |
| POST | `/vep/human/region` | Multiple variants by coords (batch) | Body: `{ "variants": ["9 22125504 . G C", ...] }` |

**HGVS Notation Formats Supported:**
- Genomic: `9:g.22125504G>C`
- Coding: `ENST00000366667:c.803C>T`
- Protein: `ENSP00000401091.1:p.Tyr124Cys`

**Rate Limits:**
- **55,000 requests per hour (3,600 seconds)** = ~15 requests/second average
- **200 variants max per POST request**

**Rate Limit Headers (MUST respect these):**
```
X-RateLimit-Limit: 55000
X-RateLimit-Period: 3600
X-RateLimit-Remaining: [remaining count]
X-RateLimit-Reset: [seconds until quota reset]
Retry-After: [seconds to wait when rate limited]
```

**Response Format:** JSON (default), XML, JSONP

**Authentication:** None required (public API)

**Error Handling Strategy:**
- Check `X-RateLimit-Remaining` header before requests
- Implement exponential backoff on 429 (Too Many Requests)
- Cache responses in SQLite temp table to minimize redundant API calls
- Respect `Retry-After` header when present

**Offline Degradation:**
- Display "VEP API unavailable" message in variant details panel
- Show only database-stored annotations (CADD, REVEL, SpliceAI from imported data)
- Provide "Retry" button for user-initiated refresh
- Do NOT block UI on API failures

**Optional Parameters (useful ones):**
- `pick=1` - Select one consequence per variant (reduces response size)
- `canonical=1` - Flag canonical transcripts
- `hgvs=1` - Include HGVS nomenclature in response
- `domains=1` - Include protein domain names
- `content-type=application/json` - Force JSON response (default is HTML)

**Integration Point:** Create new IPC handler `variants:fetch-vep-annotation` in `src/main/ipc/handlers/variants.ts` using axios

**Example axios Implementation:**
```typescript
// src/main/services/HttpService.ts
async fetchVEPAnnotation(hgvsNotation: string): Promise<any> {
  const response = await this.axiosInstance.get(
    `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(hgvsNotation)}`,
    {
      params: {
        'content-type': 'application/json',
        pick: 1,
        canonical: 1,
        hgvs: 1,
        domains: 1
      }
    }
  )
  return response.data
}
```

### HPO Ontology API (NLM Clinical Tables)

**Purpose:** Type-ahead autocomplete search for Human Phenotype Ontology terms when assigning phenotypes to cases

**API Choice:** **NLM Clinical Tables API** - Free, no authentication, designed specifically for autocomplete, actively maintained (last updated 2026-01-14)

**Why NLM Clinical Tables over alternatives:**
- **Monarch Initiative API**: More complex, no dedicated autocomplete endpoint
- **HPO JAX API** (`https://ontology.jax.org/api/hp/`): More RESTful but heavier responses, not optimized for type-ahead
- **NCBO BioPortal**: Requires API key
- **NLM Clinical Tables (CHOSEN)**: Purpose-built for autocomplete, free, simple, maintained

**Base URL:** `https://clinicaltables.nlm.nih.gov/api/hpo/v3/search`

**Endpoint:** GET with query parameters

**Query Parameters:**

| Parameter | Default | Description | Varlens Use |
|-----------|---------|-------------|-------------|
| `terms` | Required | Search string for matching HPO terms | User input from search field |
| `maxList` | 7 | Results requested (max 500) | 10-15 for autocomplete dropdown |
| `count` | 7 | Page size (max 500) | Same as maxList for autocomplete |
| `df` | id,name | Display fields | `id,name` (e.g., "HP:0001250, Seizure") |
| `sf` | id,name,synonym.term | Fields to search | Default (includes synonyms for better matching) |
| `cf` | id | Field as item code | `id` (HP:XXXXXXX) |
| `ef` | Optional | Extra fields to return | None needed initially |

**Example Request:**
```
https://clinicaltables.nlm.nih.gov/api/hpo/v3/search?terms=seizure&maxList=10&df=id,name
```

**Response Format:** JSON array with:
1. Total results count (capped at 10,000)
2. Array of codes (HP:XXXXXXX IDs)
3. Hash of extra data (from `ef` parameter, null if not requested)
4. Array of display strings (from `df` parameter)

**Example Response:**
```json
[
  1234,
  ["HP:0001250", "HP:0002373", "HP:0011097"],
  null,
  [
    ["HP:0001250", "Seizure"],
    ["HP:0002373", "Febrile seizure"],
    ["HP:0011097", "Epileptic seizure"]
  ]
]
```

**Rate Limits:** Not specified in documentation (assume reasonable use, ~10-20 requests/minute for autocomplete should be safe)

**Authentication:** None required

**Offline Degradation:**
- Show previously selected HPO terms from database
- Display "HPO search unavailable - offline mode" message in autocomplete
- Allow manual entry of HPO IDs if user has them
- Validate HPO ID format (HP:\d{7}) client-side

**Integration Point:** Create new IPC handler `cases:search-hpo-terms` in `src/main/ipc/handlers/cases.ts` using axios

**Example axios Implementation:**
```typescript
// src/main/services/HttpService.ts
async searchHPOTerms(query: string, maxResults = 10): Promise<any> {
  const response = await this.axiosInstance.get(
    'https://clinicaltables.nlm.nih.gov/api/hpo/v3/search',
    {
      params: {
        terms: query,
        maxList: maxResults,
        df: 'id,name',
        sf: 'id,name,synonym.term'
      }
    }
  )
  return response.data
}
```

---

## External Link URL Patterns

The existing Varlens URL template system (validated in v0.3.0) supports variable substitution for gnomAD, ClinVar, OMIM. Extend with these patterns for link-out targets.

| Target | URL Pattern | Variables | Notes |
|--------|-------------|-----------|-------|
| **PubTator 3.0** | `https://www.ncbi.nlm.nih.gov/research/pubtator3/?query={gene}` | `{gene}` | Search by gene symbol for literature annotations |
| **PubTator 3.0** | `https://www.ncbi.nlm.nih.gov/research/pubtator3/?query={variant}` | `{rsid}` or `{hgvs}` | Search by variant (rs number or HGVS notation) |
| **LitVar 2.0** | `https://www.ncbi.nlm.nih.gov/research/litvar2/?query={variant}` | `{rsid}`, `{hgvs}`, or `{chr}:g.{pos}{ref}>{alt}` | Semantic search for variant literature; accepts rs#, HGVS, or genomic notation (e.g., "9:g.22125504G>C") |
| **UCSC Genome Browser** | `https://genome.ucsc.edu/cgi-bin/hgTracks?db={assembly}&position={chr}:{start}-{end}` | `{assembly}` (hg19/hg38), `{chr}`, `{pos}` (use as both start and end, or add +/- 100bp padding) | Genomic region view; format: `chr1:35000-40000` |
| **DECIPHER** | `https://www.deciphergenomics.org/` | N/A (manual search) | No direct URL pattern available for programmatic linking; link to homepage for manual search by gene/phenotype/position |
| **Franklin (Genoox)** | `https://franklin.genoox.com/variant/snp/{chr}-{pos}-{ref}-{alt}` | `{chr}` (e.g., chr15), `{pos}`, `{ref}`, `{alt}` | Direct variant link; example: `chr15-72642919-G-A`; requires `chr` prefix |

**Implementation Notes:**
- Extend existing `src/main/ipc/handlers/shell.ts` allowlist to include new domains
- Existing URL template system already supports variable substitution (gnomAD, ClinVar, OMIM patterns validated in v0.3.0)
- PubTator/LitVar: Use gene symbol or rsid from database; construct HGVS if needed
- UCSC: Default to hg38; support user-configurable assembly preference (hg19/hg38)
- Franklin: Requires `chr` prefix (e.g., `chr15`, not just `15`)
- DECIPHER: No direct linking; open homepage and instruct user to search manually

**HTTPS-Only Security:** All URLs use HTTPS (validated)

**Domain Allowlist Additions:**
```typescript
// Add to src/main/ipc/handlers/shell.ts allowedDomains
'ncbi.nlm.nih.gov',           // PubTator, LitVar
'genome.ucsc.edu',            // UCSC Genome Browser
'deciphergenomics.org',       // DECIPHER
'franklin.genoox.com'         // Franklin (Genoox)
```

**Example URL Construction (in `src/shared/externalLinks.ts`):**
```typescript
export const externalLinks = {
  pubtator: (gene: string) =>
    `https://www.ncbi.nlm.nih.gov/research/pubtator3/?query=${encodeURIComponent(gene)}`,

  litvar: (rsid: string) =>
    `https://www.ncbi.nlm.nih.gov/research/litvar2/?query=${encodeURIComponent(rsid)}`,

  ucsc: (chr: string, pos: number, assembly = 'hg38') => {
    const padding = 100
    return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${assembly}&position=chr${chr}:${pos - padding}-${pos + padding}`
  },

  franklin: (chr: string, pos: number, ref: string, alt: string) =>
    `https://franklin.genoox.com/variant/snp/chr${chr}-${pos}-${ref}-${alt}`,

  decipher: () => 'https://www.deciphergenomics.org/'
}
```

---

## SQLite Schema Patterns

### Design Decision: Normalized Tables vs JSON Columns

**Decision:** Store annotations in separate tables with foreign keys to `variants.id` (normalized) rather than JSON columns in variants table.

**Rationale:**
- SQLite has no native JSON type (stored as TEXT)
- better-sqlite3 does no automatic JSON handling (manual `JSON.stringify()`/`JSON.parse()`)
- Normalized tables provide better query performance, type safety, and migration flexibility
- Easier to index and filter (e.g., "show all starred variants", "show all pathogenic classifications")

**When JSON IS appropriate:**
- VEP API response caching (ephemeral, not frequently queried)
- User preferences (key-value config)

### Variant Annotations Storage

**New Tables:**

```sql
-- Global variant comments (apply to variant across all cases)
CREATE TABLE IF NOT EXISTS variant_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at INTEGER NOT NULL,  -- Unix timestamp (seconds since epoch)
  updated_at INTEGER NOT NULL,  -- Unix timestamp
  UNIQUE(chr, pos, ref, alt)    -- One comment per unique variant
);
CREATE INDEX idx_variant_comments_variant ON variant_comments(chr, pos, ref, alt);

-- Per-case variant comments (variant in specific case)
CREATE TABLE IF NOT EXISTS case_variant_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,  -- Foreign key to variants.id
  comment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  UNIQUE(case_id, variant_id)   -- One comment per variant per case
);
CREATE INDEX idx_case_variant_comments_case ON case_variant_comments(case_id);
CREATE INDEX idx_case_variant_comments_variant ON case_variant_comments(variant_id);

-- Variant markers (star/flag + ACMG classification)
CREATE TABLE IF NOT EXISTS variant_markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  starred INTEGER NOT NULL DEFAULT 0,      -- Boolean: 0 = not starred, 1 = starred
  flagged INTEGER NOT NULL DEFAULT 0,      -- Boolean: 0 = not flagged, 1 = flagged
  acmg_class TEXT CHECK(acmg_class IN (NULL, 'pathogenic', 'likely_pathogenic', 'vus', 'likely_benign', 'benign')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  UNIQUE(case_id, variant_id)   -- One marker per variant per case
);
CREATE INDEX idx_variant_markers_case ON variant_markers(case_id);
CREATE INDEX idx_variant_markers_variant ON variant_markers(variant_id);
CREATE INDEX idx_variant_markers_starred ON variant_markers(starred);
CREATE INDEX idx_variant_markers_flagged ON variant_markers(flagged);
CREATE INDEX idx_variant_markers_acmg ON variant_markers(acmg_class);

-- Custom user-defined tags (many-to-many)
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,  -- Hex color code (e.g., '#FF5733')
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS variant_tags (
  variant_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, case_id, tag_id)
);
CREATE INDEX idx_variant_tags_variant ON variant_tags(variant_id, case_id);
CREATE INDEX idx_variant_tags_tag ON variant_tags(tag_id);
```

### Case Metadata Storage

**Extend existing `cases` table with new columns:**

```sql
-- Migration: Add new columns to cases table
ALTER TABLE cases ADD COLUMN affected_status TEXT CHECK(affected_status IN (NULL, 'affected', 'unaffected', 'unknown')) DEFAULT NULL;
ALTER TABLE cases ADD COLUMN cohort_group TEXT DEFAULT NULL;  -- Arbitrary user-defined cohort name

-- Case HPO phenotype terms (many-to-many)
CREATE TABLE IF NOT EXISTS case_phenotypes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  hpo_id TEXT NOT NULL,        -- HP:XXXXXXX format
  hpo_name TEXT NOT NULL,      -- Human-readable name (e.g., "Seizure")
  created_at INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, hpo_id)       -- One HPO term per case (no duplicates)
);
CREATE INDEX idx_case_phenotypes_case ON case_phenotypes(case_id);
CREATE INDEX idx_case_phenotypes_hpo ON case_phenotypes(hpo_id);
```

### Timestamp Best Practices

**Storage Format:** Unix timestamp (INTEGER) in seconds since epoch

**Rationale:**
- Compact storage (INTEGER vs TEXT)
- Easy sorting and comparison (numeric)
- Simple delta calculations (`updated_at - created_at`)
- Compatible with JavaScript `Math.floor(Date.now() / 1000)`
- No timezone ambiguity (UTC by definition)

**Display:** Convert to ISO8601 or localized format in renderer using JavaScript `Date` or Vuetify date formatting

**Example Insertion:**
```typescript
const now = Math.floor(Date.now() / 1000)
db.prepare(
  'INSERT INTO variant_comments (chr, pos, ref, alt, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
).run(chr, pos, ref, alt, comment, now, now)
```

**Example Update:**
```typescript
const now = Math.floor(Date.now() / 1000)
db.prepare(
  'UPDATE variant_comments SET comment = ?, updated_at = ? WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
).run(comment, now, chr, pos, ref, alt)
```

---

## ACMG Classification Data Model

**ACMG 5-Tier System:** Standard classification for Mendelian disorder variant pathogenicity (ACMG/AMP 2015 guidelines)

| Tier | Value (DB) | Display Name | Confidence Threshold | Color (UI) |
|------|------------|--------------|---------------------|------------|
| 5 | `pathogenic` | Pathogenic (P) | >99% disease-causing | Red (error) |
| 4 | `likely_pathogenic` | Likely Pathogenic (LP) | >90% disease-causing | Orange (warning) |
| 3 | `vus` | Uncertain Significance (VUS) | Insufficient evidence | Gray (default) |
| 2 | `likely_benign` | Likely Benign (LB) | >90% benign | Light green (success-lighten-2) |
| 1 | `benign` | Benign (B) | >99% benign | Green (success) |

**TypeScript Enum:**
```typescript
// src/shared/types/acmg.ts
export enum ACMGClassification {
  Pathogenic = 'pathogenic',
  LikelyPathogenic = 'likely_pathogenic',
  VUS = 'vus',
  LikelyBenign = 'likely_benign',
  Benign = 'benign'
}

export const ACMG_DISPLAY_NAMES: Record<ACMGClassification, string> = {
  [ACMGClassification.Pathogenic]: 'Pathogenic',
  [ACMGClassification.LikelyPathogenic]: 'Likely Pathogenic',
  [ACMGClassification.VUS]: 'Uncertain Significance',
  [ACMGClassification.LikelyBenign]: 'Likely Benign',
  [ACMGClassification.Benign]: 'Benign'
}

export const ACMG_COLORS: Record<ACMGClassification, string> = {
  [ACMGClassification.Pathogenic]: 'error',
  [ACMGClassification.LikelyPathogenic]: 'warning',
  [ACMGClassification.VUS]: 'grey',
  [ACMGClassification.LikelyBenign]: 'success-lighten-2',
  [ACMGClassification.Benign]: 'success'
}
```

**SQLite CHECK Constraint:** `CHECK(acmg_class IN (NULL, 'pathogenic', 'likely_pathogenic', 'vus', 'likely_benign', 'benign'))`

**UI Display:** Use Vuetify `v-chip` with color from `ACMG_COLORS` mapping

**No External Package Needed:** Simple enum, no complex logic required. ACMG criteria evaluation (PVS1, PS1-4, PM1-6, PP1-5, BA1, BS1-4, BP1-7) is out of scope for this milestone (requires deep domain knowledge + evidence gathering from multiple sources). Users manually assign classification based on their clinical judgment.

---

## Integration Points

### 1. IPC Handlers (Main Process)

**New handlers needed:**

```typescript
// src/main/ipc/handlers/variants.ts
'variants:add-comment'           // Add global variant comment
'variants:update-comment'        // Update global variant comment
'variants:delete-comment'        // Delete global variant comment
'variants:get-comment'           // Get global variant comment by chr/pos/ref/alt
'variants:add-case-comment'      // Add per-case variant comment
'variants:update-case-comment'   // Update per-case variant comment
'variants:delete-case-comment'   // Delete per-case variant comment
'variants:get-case-comment'      // Get per-case variant comment
'variants:set-marker'            // Set star/flag/ACMG classification
'variants:get-marker'            // Get marker status for variant in case
'variants:add-tag'               // Add custom tag to variant
'variants:remove-tag'            // Remove custom tag from variant
'variants:list-tags'             // List all user-defined tags
'variants:create-tag'            // Create new tag with name and color
'variants:delete-tag'            // Delete tag (and all variant_tags associations)
'variants:fetch-vep-annotation'  // Fetch VEP annotation via API

// src/main/ipc/handlers/cases.ts
'cases:update-metadata'          // Update affected_status, cohort_group
'cases:add-phenotype'            // Add HPO term to case
'cases:remove-phenotype'         // Remove HPO term from case
'cases:list-phenotypes'          // List all HPO terms for case
'cases:search-hpo-terms'         // Search HPO API for autocomplete
```

### 2. HTTP Service (New)

**Location:** `src/main/services/HttpService.ts` (new file)

```typescript
import axios, { AxiosInstance } from 'axios'

export class HttpService {
  private axiosInstance: AxiosInstance
  private vepRateLimitRemaining = 55000
  private vepRateLimitReset = 0

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    })

    // Response interceptor for rate limit tracking
    this.axiosInstance.interceptors.response.use(
      (response) => {
        // Track VEP rate limits
        if (response.config.url?.includes('rest.ensembl.org')) {
          const remaining = response.headers['x-ratelimit-remaining']
          const reset = response.headers['x-ratelimit-reset']
          if (remaining) this.vepRateLimitRemaining = parseInt(remaining)
          if (reset) this.vepRateLimitReset = Date.now() + parseInt(reset) * 1000
        }
        return response
      },
      (error) => {
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after']
          console.warn(`Rate limited. Retry after ${retryAfter} seconds`)
          throw new Error(`Rate limited. Retry after ${retryAfter} seconds.`)
        }
        throw error
      }
    )
  }

  async fetchVEPAnnotation(hgvsNotation: string): Promise<any> {
    const response = await this.axiosInstance.get(
      `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(hgvsNotation)}`,
      {
        params: {
          'content-type': 'application/json',
          pick: 1,
          canonical: 1,
          hgvs: 1,
          domains: 1
        }
      }
    )
    return response.data
  }

  async searchHPOTerms(query: string, maxResults = 10): Promise<any> {
    const response = await this.axiosInstance.get(
      'https://clinicaltables.nlm.nih.gov/api/hpo/v3/search',
      {
        params: {
          terms: query,
          maxList: maxResults,
          df: 'id,name',
          sf: 'id,name,synonym.term'
        }
      }
    )
    return response.data
  }

  getVEPRateLimitStatus() {
    return {
      remaining: this.vepRateLimitRemaining,
      resetAt: this.vepRateLimitReset
    }
  }
}
```

### 3. Database Service Extensions

**Location:** `src/main/database/DatabaseService.ts`

Add methods for:
- Comment CRUD operations (global and per-case)
- Marker CRUD operations (star, flag, ACMG class)
- Tag CRUD operations (create tag, assign to variant)
- Case metadata updates (affected_status, cohort_group)
- HPO term associations (add, remove, list)

Use existing pattern: prepared statements, transaction support, error handling via try/catch

### 4. External Links Extension

**Location:** `src/shared/externalLinks.ts` (new file or extend existing)

Add new URL patterns to configuration:

```typescript
export const externalLinks = {
  // Existing: gnomad, clinvar, omim (from v0.3.0)
  pubtator: (gene: string) =>
    `https://www.ncbi.nlm.nih.gov/research/pubtator3/?query=${encodeURIComponent(gene)}`,

  litvar: (variant: string) =>
    `https://www.ncbi.nlm.nih.gov/research/litvar2/?query=${encodeURIComponent(variant)}`,

  ucsc: (chr: string, pos: number, assembly = 'hg38') => {
    const padding = 100
    return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${assembly}&position=chr${chr}:${pos - padding}-${pos + padding}`
  },

  franklin: (chr: string, pos: number, ref: string, alt: string) =>
    `https://franklin.genoox.com/variant/snp/chr${chr}-${pos}-${ref}-${alt}`,

  decipher: () => 'https://www.deciphergenomics.org/'
}
```

---

## Alternatives Considered

### HTTP Client: axios vs fetch vs Electron net

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **axios** | Auto error handling (throws on 4xx/5xx), interceptors, clean API, battle-tested, request/response transformation | 11.7kB gzipped | **RECOMMENDED** |
| **Native fetch** | Zero deps, built into Node 18+ | Manual error handling, no interceptors, more boilerplate for rate limiting | Viable but less DX |
| **Electron net** | Chromium networking, system proxy support | Electron-specific API, less familiar to developers | Unnecessary for REST APIs |

**Decision:** axios for better DX and built-in rate limiting support via interceptors

### HPO API: NLM Clinical Tables vs Monarch vs JAX

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **NLM Clinical Tables** | Purpose-built autocomplete, free, simple JSON, includes synonyms | Limited to autocomplete use case | **RECOMMENDED** |
| **Monarch Initiative** | Comprehensive ontology data | No autocomplete endpoint, complex responses | Over-engineered for autocomplete |
| **JAX HPO API** | Official HPO source | Heavier responses, not optimized for autocomplete | Good for detailed lookups, not autocomplete |

**Decision:** NLM Clinical Tables for autocomplete; consider JAX API for detailed term info if needed later

### Annotation Storage: JSON vs Normalized Tables

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Normalized tables** | Type safety, query performance, schema evolution, easy filtering/indexing | More tables to manage | **RECOMMENDED** |
| **JSON columns** | Flexible schema, fewer tables | Manual serialization (no native JSON type), poor query support, no type safety | Not worth the flexibility |

**Decision:** Normalized tables for annotations, comments, markers

---

## Version Compatibility

| Dependency | Minimum Version | Latest Stable | Electron 40 Compatible |
|------------|-----------------|---------------|------------------------|
| axios | 1.7.0 | 1.13.3 | Yes (Node.js 20.x) |
| Electron | 40 | 40 | Already deployed |
| better-sqlite3-multiple-ciphers | 12.6.2 | 12.6.2 | Yes (prebuilts available) |
| Node.js (Electron's) | 20.x | 20.x (Electron 40) | Native fetch available but axios preferred |

---

## Installation Summary

```bash
# Add new dependency
npm install axios

# No other new dependencies needed
```

**Total new runtime dependencies:** 1 (axios)

**Total dependency increase:** +1 package (+11.7kB gzipped)

---

## Dependency Impact Summary

| Dependency | Type | Native? | Size Impact | Risk |
|------------|------|---------|-------------|------|
| `axios` | New | No (pure JS) | 11.7kB gzipped | LOW -- mature, 167,351 dependent projects, widely used in Electron apps |

---

## Sources

### Ensembl VEP REST API
- [Rate Limits - Ensembl/ensembl-rest Wiki](https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits)
- [Ensembl REST API Endpoints](https://rest.ensembl.org/)
- [VEP HGVS GET Endpoint Documentation](https://rest.ensembl.org/documentation/info/vep_hgvs_get)

### HPO Ontology API
- [NLM Clinical Tables API for HPO v3 Documentation](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html)
- [Expansion of the Human Phenotype Ontology (HPO) knowledge base and resources](https://academic.oup.com/nar/article/47/D1/D1018/5198478)
- [hpo-js npm package](https://www.npmjs.com/package/hpo-js) (evaluated, not recommended)

### ACMG Guidelines
- [Standards and Guidelines for the Interpretation of Sequence Variants (ACMG/AMP 2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/)
- [Understanding ACMG Guidelines: Standards for Genetic Testing](https://3billion.io/blog/what-are-the-acmg-standards-and-guidelines-and-how-do-they-work)
- [Variant Classification using ACMG/AMP Guidelines - ClinGen](https://clinicalgenome.org/tools/h3africa-rdwg-workshop/variant-classification-using-acmg-amp-interpreting-sequence-guidelines/)

### HTTP Clients
- [Axios vs Fetch: Which Should You Use in 2026?](https://iproyal.com/blog/axios-vs-fetch/)
- [Axios vs. Fetch (2025 update) - LogRocket](https://blog.logrocket.com/axios-vs-fetch-2025/)
- [HTTP REST API Calls in ElectronJS](https://www.tutorialspoint.com/http-rest-api-calls-in-electronjs)
- [axios npm package](https://www.npmjs.com/package/axios)

### External Links
- [PubTator 3.0: AI-powered literature resource](https://pmc.ncbi.nlm.nih.gov/articles/PMC11223843/)
- [PubTator 3.0 Web Interface](https://www.ncbi.nlm.nih.gov/research/pubtator3/)
- [LitVar 2.0: Tracking genetic variants in literature](https://pmc.ncbi.nlm.nih.gov/articles/PMC11096795/)
- [LitVar 2.0 Web Interface](https://www.ncbi.nlm.nih.gov/research/litvar2/)
- [LitVar API Documentation](https://www.ncbi.nlm.nih.gov/CBBresearch/Lu/Demo/LitVar/api.html)
- [UCSC Genome Browser FAQ - Linking](https://genome.ucsc.edu/FAQ/FAQlink.html)
- [DECIPHER: Supporting variant interpretation](https://pmc.ncbi.nlm.nih.gov/articles/PMC9303633/)
- [DECIPHER Web Interface](https://www.deciphergenomics.org/)
- [Franklin by Genoox Example Variant](https://franklin.genoox.com/variant/snp/chr15-72642919-G-A)

### SQLite Best Practices
- [Best Practices for Managing Schema in SQLite for Data Engineering](https://medium.com/@firmanbrilian/best-practices-for-managing-schema-indexes-and-storage-in-sqlite-for-data-engineering-266b7fa65f4c)
- [10 Rules for a Better SQL Schema - Sisense](https://www.sisense.com/blog/better-sql-schema/)
- [Storing and Querying JSON in SQLite - Beekeeper Studio](https://www.beekeeperstudio.io/blog/sqlite-json)
- [better-sqlite3 JSON Discussion](https://github.com/WiseLibs/better-sqlite3/discussions/1098)
