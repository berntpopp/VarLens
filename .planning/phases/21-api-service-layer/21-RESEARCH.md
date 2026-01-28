# Phase 21: API Service Layer - Research

**Researched:** 2026-01-28
**Domain:** HTTP API clients for genetic variant annotation (VEP, HPO) with SQLite caching and offline handling in Electron
**Confidence:** HIGH

## Summary

The API service layer implements Ensembl VEP and HPO API clients in the Electron main process with SQLite-based caching, rate limiting, and graceful offline degradation. Node.js 18+ provides a native fetch API (powered by Undici) that eliminates the need for external HTTP client libraries. Modern patterns use `ipcMain.handle()` with async/await for clean request-response IPC communication. Zod provides TypeScript-first schema validation for runtime response verification.

The standard approach uses:
1. Native fetch API in main process for HTTP requests
2. Bottleneck library for rate limiting (15 req/sec for VEP)
3. Zod schemas for response validation
4. SQLite with TTL-based expiration (30 days) and indexed cache keys
5. AbortController for request cancellation when user selects different variant
6. Electron's net module (net.isOnline) for online/offline detection
7. Exponential backoff with jitter for 429 retry handling

**Primary recommendation:** Use native fetch with Bottleneck rate limiter, validate VEP responses with Zod schemas matching transcript_consequences structure, and implement cache-key based on normalized chr:pos:ref:alt format with left-aligned parsimonious representation.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native fetch | Node.js 18+ | HTTP client | Built-in, standards-compliant, powered by high-performance Undici |
| bottleneck | 2.19+ | Rate limiting | Battle-hardened, supports Redis clustering, built-in retry logic |
| zod | 3.23+ | Schema validation | TypeScript-first, runtime type safety, 2kb gzipped |
| better-sqlite3 | (existing) | Cache storage | Already in project, excellent performance with WAL mode |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| exponential-backoff | 3.1+ | Retry logic | If implementing custom backoff (Bottleneck has built-in retry) |
| nock | 13.5+ | HTTP mocking | Testing API clients without network calls |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch | axios | Axios adds automatic JSON parsing and better error handling, but adds 11kb dependency when native fetch is sufficient |
| Bottleneck | p-ratelimit | p-ratelimit is simpler but lacks Redis clustering support and job scheduling features |
| Zod | yup, joi | Zod has best TypeScript inference and smallest bundle size (2kb vs 15kb+) |

**Installation:**
```bash
npm install bottleneck zod
npm install --save-dev nock @types/better-sqlite3
```

## Architecture Patterns

### Recommended Project Structure
```
src/main/
├── services/
│   ├── api/
│   │   ├── VepApiClient.ts      # VEP REST API client with rate limiting
│   │   ├── HpoApiClient.ts      # HPO autocomplete API client
│   │   ├── ApiCache.ts          # Unified cache layer for both APIs
│   │   └── schemas/
│   │       ├── vep-response.ts  # Zod schema for VEP JSON response
│   │       └── hpo-response.ts  # Zod schema for HPO autocomplete
│   └── network/
│       └── onlineStatus.ts      # Online/offline detection service
└── ipc/
    └── handlers/
        ├── vepHandlers.ts       # IPC: vep:fetch, vep:clearCache
        └── hpoHandlers.ts       # IPC: hpo:search, hpo:clearCache

src/shared/types/
└── api.d.ts                     # Inferred types from Zod schemas
```

### Pattern 1: Rate-Limited API Client with Caching

**What:** Service class encapsulating HTTP client, rate limiter, cache layer, and response validation

**When to use:** All external API integrations requiring rate limiting and caching

**Example:**
```typescript
// Source: Bottleneck documentation + Zod validation pattern
import Bottleneck from 'bottleneck'
import { z } from 'zod'
import type Database from 'better-sqlite3-multiple-ciphers'

// Zod schema for VEP response validation
const VepTranscriptConsequenceSchema = z.object({
  transcript_id: z.string(),
  consequence_terms: z.array(z.string()),
  impact: z.enum(['HIGH', 'MODERATE', 'LOW', 'MODIFIER']).optional(),
  cadd_phred: z.number().optional(),
  revel_score: z.number().optional(),
  sift_prediction: z.string().optional(),
  polyphen_prediction: z.string().optional(),
  // SpliceAI delta scores
  spliceai_pred_ds_ag: z.number().optional(),
  spliceai_pred_ds_al: z.number().optional(),
  spliceai_pred_ds_dg: z.number().optional(),
  spliceai_pred_ds_dl: z.number().optional(),
})

const VepResponseSchema = z.array(
  z.object({
    id: z.string().optional(),
    input: z.string(),
    transcript_consequences: z.array(VepTranscriptConsequenceSchema).optional(),
    colocated_variants: z.array(z.any()).optional(),
  })
)

export type VepResponse = z.infer<typeof VepResponseSchema>

export class VepApiClient {
  private limiter: Bottleneck
  private cache: ApiCache
  private baseUrl = 'https://rest.ensembl.org'
  private abortController?: AbortController

  constructor(db: Database.Database) {
    // Configure rate limiter: 15 req/sec max
    this.limiter = new Bottleneck({
      reservoir: 55000,           // 55k requests
      reservoirRefreshAmount: 55000,
      reservoirRefreshInterval: 60 * 60 * 1000, // per hour
      maxConcurrent: 1,
      minTime: 67,                // ~15 req/sec (1000ms / 15 = 67ms)
    })

    // Retry on 429 with exponential backoff
    this.limiter.on('failed', async (error, jobInfo) => {
      if (error.message.includes('429') && jobInfo.retryCount < 3) {
        const delay = Math.min(1000 * Math.pow(2, jobInfo.retryCount), 8000)
        return delay // Retry after 1s, 2s, 4s
      }
    })

    this.cache = new ApiCache(db)
  }

  async fetchVariantAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<VepResponse> {
    // Generate cache key from normalized variant
    const cacheKey = `vep:${chr}:${pos}:${ref}:${alt}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return VepResponseSchema.parse(JSON.parse(cached))
    }

    // Cancel previous request if exists
    if (this.abortController) {
      this.abortController.abort()
    }
    this.abortController = new AbortController()

    // Make rate-limited request
    const response = await this.limiter.schedule(() =>
      this.makeVepRequest(chr, pos, ref, alt, this.abortController!.signal)
    )

    // Validate and cache response
    const validated = VepResponseSchema.parse(response)
    this.cache.set(cacheKey, JSON.stringify(validated), 30) // 30-day TTL

    return validated
  }

  private async makeVepRequest(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    signal: AbortSignal
  ): Promise<unknown> {
    const region = `${chr}:${pos}-${pos}:1`
    const allele = alt

    const url = `${this.baseUrl}/vep/human/region/${region}/${allele}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
    })

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      throw new Error(`429:${retryAfter || '1'}`)
    }

    if (!response.ok) {
      throw new Error(`VEP API error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  cancelPendingRequest(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }
  }
}
```

### Pattern 2: SQLite Cache with TTL Expiration

**What:** Cache layer using SQLite with indexed lookups and automatic TTL-based expiration

**When to use:** Any service requiring persistent caching with expiration

**Example:**
```typescript
// Source: SQLite cache TTL patterns + better-sqlite3 documentation
import type Database from 'better-sqlite3-multiple-ciphers'

export class ApiCache {
  private db: Database.Database
  private getStmt: Database.Statement
  private setStmt: Database.Statement
  private deleteExpiredStmt: Database.Statement

  constructor(db: Database.Database) {
    this.db = db

    // Prepare statements for performance
    this.getStmt = db.prepare(`
      SELECT response_data, created_at
      FROM api_cache
      WHERE cache_key = ? AND expires_at > ?
    `)

    this.setStmt = db.prepare(`
      INSERT INTO api_cache (cache_key, response_data, created_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        response_data = excluded.response_data,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `)

    this.deleteExpiredStmt = db.prepare(`
      DELETE FROM api_cache WHERE expires_at <= ?
    `)
  }

  get(key: string): { data: string; createdAt: number } | null {
    const now = Date.now()
    const result = this.getStmt.get(key, now) as
      | { response_data: string; created_at: number }
      | undefined

    if (!result) return null

    return {
      data: result.response_data,
      createdAt: result.created_at,
    }
  }

  set(key: string, data: string, ttlDays: number): void {
    const now = Date.now()
    const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000

    this.setStmt.run(key, data, now, expiresAt)
  }

  clearByPrefix(prefix: string): void {
    this.db.prepare(`DELETE FROM api_cache WHERE cache_key LIKE ?`).run(`${prefix}%`)
  }

  getCacheSize(): number {
    const result = this.db.prepare(`SELECT COUNT(*) as count FROM api_cache`).get() as {
      count: number
    }
    return result.count
  }

  // Run periodically (e.g., on app startup or daily)
  cleanupExpired(): void {
    const now = Date.now()
    this.deleteExpiredStmt.run(now)
  }
}
```

### Pattern 3: IPC Handler with Online/Offline Checking

**What:** IPC handler that checks online status before making API calls, returns cached data when offline

**When to use:** All IPC handlers that invoke external API services

**Example:**
```typescript
// Source: Electron IPC handle pattern + net.isOnline documentation
import { ipcMain, net } from 'electron'
import { VepApiClient } from '../services/api/VepApiClient'

export function registerVepHandlers(vepClient: VepApiClient): void {
  ipcMain.handle('vep:fetch', async (event, chr: string, pos: number, ref: string, alt: string) => {
    try {
      // Check online status first
      if (!net.isOnline()) {
        // Try to return cached data
        const cacheKey = `vep:${chr}:${pos}:${ref}:${alt}`
        const cached = vepClient.getCached(cacheKey)

        if (cached) {
          return {
            success: true,
            data: cached.data,
            cached: true,
            cachedAt: cached.createdAt,
            offline: true,
          }
        }

        return {
          success: false,
          error: 'API enrichment unavailable - offline',
          offline: true,
        }
      }

      // Online: fetch from API (with cache check inside)
      const data = await vepClient.fetchVariantAnnotation(chr, pos, ref, alt)

      return {
        success: true,
        data,
        cached: false,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  ipcMain.handle('vep:clearCache', async () => {
    vepClient.clearCache()
    return { success: true }
  })
}
```

### Anti-Patterns to Avoid

- **Running API requests in renderer process:** Violates security best practices, exposes API keys in client code, bypasses rate limiting coordination
- **Using raw fetch without rate limiting:** Will trigger 429 responses from Ensembl, causes API quota exhaustion
- **Skipping response validation:** API format changes cause runtime crashes, malformed data propagates through app
- **Cache keys with unnormalized variants:** Same variant with different representations (e.g., left vs right aligned) creates duplicate cache entries
- **Synchronous SQLite in main event loop:** Blocks Electron main process, causes UI freezes during cache operations

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom queue with setTimeout | Bottleneck library | Job scheduling, Redis clustering, exponential backoff built-in, handles 429 responses |
| Response validation | Manual type checks | Zod schemas | Runtime type safety, automatic TypeScript inference, detailed error messages |
| Exponential backoff | Custom retry logic | Bottleneck's 'failed' event | Jitter included, configurable max retries, integrates with rate limiter |
| HTTP mocking in tests | Manual mock objects | Nock library | Intercepts at http.request level, supports all verbs, automatic cleanup |
| Variant normalization | String manipulation | bcftools norm or vt normalize | Left-alignment, parsimonious representation, handles complex indels correctly |
| Cache key generation | Simple string concat | Hash of normalized variant | Prevents collisions, handles special characters, consistent format |

**Key insight:** Rate limiting is deceptively complex - naive implementations fail on burst traffic, don't handle quota resets, and lack backoff strategies. Bottleneck solves these with reservoir-based limiting, automatic quota refresh, and failure event hooks.

## Common Pitfalls

### Pitfall 1: VEP POST Endpoint Overload

**What goes wrong:** Using POST endpoint with 200 variants (documented maximum) causes 504 Gateway timeout errors followed by 503 Service Unavailable

**Why it happens:** VEP backend has practical limits lower than documented maximum, especially with multiple annotation plugins enabled (CADD, REVEL, SpliceAI)

**How to avoid:** Keep POST requests to 50 or fewer variants at a time. For single-variant lookups (side panel use case), use GET endpoint which is more reliable.

**Warning signs:** Intermittent 504 errors, followed by 503 errors after multiple retries

### Pitfall 2: Unnormalized Cache Keys

**What goes wrong:** Same variant stored multiple times with different representations (e.g., chr1:100:AT:A vs chr1:99:CAT:C), cache hit rate drops dramatically

**Why it happens:** VCF representations can vary (right-aligned vs left-aligned indels, with/without anchoring bases), input data isn't normalized before cache key generation

**How to avoid:** Normalize all variants to left-aligned, parsimonious representation before generating cache key. Use format: `${chr}:${pos}:${ref}:${alt}` where chr is without "chr" prefix (e.g., "1" not "chr1"), and indels are left-aligned with anchoring base.

**Warning signs:** Low cache hit rate despite fetching same variants, cache size growing faster than expected

### Pitfall 3: Thundering Herd on Cache Expiration

**What goes wrong:** Many cache entries expire simultaneously, triggering burst of API requests that exceed rate limit, causes cascade of 429 errors

**Why it happens:** All cache entries from initial app usage have same 30-day TTL, expire together, no TTL jitter to spread expirations

**How to avoid:** Add random jitter to TTL (±10% = 27-33 days instead of exactly 30). Implement stale-while-revalidate pattern: return expired cache immediately, fetch fresh data in background.

**Warning signs:** Periodic clusters of 429 errors roughly 30 days apart, many simultaneous API requests

### Pitfall 4: AbortController Reuse

**What goes wrong:** Calling `abort()` on same AbortController instance for multiple sequential requests causes "already aborted" errors

**Why it happens:** AbortController signal remains in aborted state permanently after first abort() call, cannot be reset or reused

**How to avoid:** Create new AbortController instance for each request. Store as instance property, replace with new instance before each fetch.

**Warning signs:** Intermittent "signal is aborted" errors, especially when user rapidly switches between variants

### Pitfall 5: Missing gnomAD Frequency Data

**What goes wrong:** VEP response lacks expected gnomAD allele frequency fields for some variants, causes undefined errors in UI

**Why it happens:** VEP cache files only contain gnomAD exome frequencies imported from dbSNP, not all variants have frequency data, response format varies based on availability

**How to avoid:** Make all frequency fields optional in Zod schema, handle missing data in UI with "No frequency data available" message, don't assume all variants have population frequencies.

**Warning signs:** Runtime errors accessing frequency properties, inconsistent data display for different variants

### Pitfall 6: WAL Checkpoint Starvation

**What goes wrong:** SQLite WAL file grows unbounded when cache writes are frequent and reads are everlasting concurrent, database performance degrades over time

**Why it happens:** SQLite cannot recycle WAL file due to long-running read transactions, checkpoint operation deferred indefinitely

**How to avoid:** Call `db.checkpoint()` periodically (e.g., after every 1000 cache writes or when WAL exceeds 10MB). Use `PRAGMA journal_size_limit` to cap WAL size. Ensure read transactions are short-lived.

**Warning signs:** Growing .db-wal file size (check with fs.statSync), degrading query performance, disk space issues

## Code Examples

Verified patterns from official sources:

### HPO Autocomplete API Client

```typescript
// Source: NLM Clinical Tables API documentation
import { z } from 'zod'

const HpoTermSchema = z.tuple([
  z.string(), // HPO ID (e.g., "HP:0001250")
  z.string(), // Term name (e.g., "Seizure")
])

const HpoAutocompleteResponseSchema = z.tuple([
  z.number(),                      // Total count
  z.array(z.string()),            // Array of HPO IDs
  z.record(z.any()).nullable(),   // Extra data (can be null)
  z.array(HpoTermSchema),         // Array of [id, name] pairs
])

export type HpoAutocompletResponse = z.infer<typeof HpoAutocompleteResponseSchema>

export class HpoApiClient {
  private baseUrl = 'https://clinicaltables.nlm.nih.gov/api/hpo/v3/search'

  async search(query: string, maxResults = 20): Promise<Array<{ id: string; name: string }>> {
    // No rate limiting needed - NLM API has no documented rate limits
    // But implement basic throttling as courtesy

    const url = new URL(this.baseUrl)
    url.searchParams.set('terms', query)
    url.searchParams.set('count', maxResults.toString())
    url.searchParams.set('df', 'id,name') // Display fields

    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HPO API error: ${response.status}`)
    }

    const data = await response.json()
    const validated = HpoAutocompleteResponseSchema.parse(data)

    // Transform [id, name] tuples into objects
    return validated[3].map(([id, name]) => ({ id, name }))
  }
}
```

### Exponential Backoff with Jitter

```typescript
// Source: Exponential backoff pattern from AWS + Tyler Crosse blog
function exponentialBackoffWithJitter(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 8000
): number {
  // Calculate exponential delay: baseDelay * 2^attempt
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)

  // Add jitter: random value between 50% and 100% of calculated delay
  // Prevents thundering herd when multiple clients retry simultaneously
  const jitter = exponentialDelay * (0.5 + Math.random() * 0.5)

  return Math.floor(jitter)
}

// Usage in Bottleneck failed event:
limiter.on('failed', async (error, jobInfo) => {
  if (error.message.includes('429') && jobInfo.retryCount < 3) {
    return exponentialBackoffWithJitter(jobInfo.retryCount)
  }
  // Don't retry for other errors
  return null
})
```

### Online Status Monitoring

```typescript
// Source: Electron net module documentation
import { net } from 'electron'

export class NetworkStatus {
  private isOnline: boolean = true
  private listeners: Array<(online: boolean) => void> = []

  constructor() {
    // Check initial status
    this.isOnline = net.isOnline()

    // Note: net module doesn't emit events, need to poll
    // For production, consider using navigator.onLine in renderer
    // and forwarding events via IPC
    setInterval(() => {
      const currentStatus = net.isOnline()
      if (currentStatus !== this.isOnline) {
        this.isOnline = currentStatus
        this.notifyListeners()
      }
    }, 5000) // Check every 5 seconds
  }

  getStatus(): boolean {
    return net.isOnline()
  }

  onChange(callback: (online: boolean) => void): void {
    this.listeners.push(callback)
  }

  private notifyListeners(): void {
    this.listeners.forEach((cb) => cb(this.isOnline))
  }
}
```

### Clinical Score Thresholds

```typescript
// Source: ACMG guidelines + ClinGen expert panel specifications
export const CLINICAL_THRESHOLDS = {
  CADD: {
    pathogenic: 20,      // CADD >= 20 suggests pathogenicity
    uncertain: 10,       // 10-20 uncertain significance
    benign: 10,          // CADD <= 10 suggests benign
  },
  REVEL: {
    pathogenic: {
      supporting: 0.644,   // PP3 Supporting >= 0.644
      moderate: 0.773,     // PP3 Moderate >= 0.773
      strong: 0.932,       // PP3 Strong >= 0.932
    },
    benign: {
      supporting: 0.290,   // BP4 Supporting <= 0.290
      moderate: 0.183,     // BP4 Moderate <= 0.183
      strong: 0.016,       // BP4 Strong <= 0.016
      veryStrong: 0.003,   // BP4 Very Strong <= 0.003
    },
  },
  SPLICEAI: {
    pathogenic: 0.2,     // PP3 threshold (Walker et al. 2023)
    benign: 0.1,         // BP4 threshold
    maxDelta: 0.5,       // Delta >= 0.5 high confidence splice impact
  },
  GNOMAD_AF: {
    rare: 0.01,          // AF < 1% considered rare
    veryRare: 0.001,     // AF < 0.1% very rare
    common: 0.05,        // AF > 5% likely benign (PM2/BA1)
  },
} as const

export function getCADDClassification(
  score: number | undefined
): 'pathogenic' | 'uncertain' | 'benign' | 'unknown' {
  if (score === undefined) return 'unknown'
  if (score >= CLINICAL_THRESHOLDS.CADD.pathogenic) return 'pathogenic'
  if (score <= CLINICAL_THRESHOLDS.CADD.benign) return 'benign'
  return 'uncertain'
}

export function getREVELClassification(
  score: number | undefined
): 'pathogenic' | 'uncertain' | 'benign' | 'unknown' {
  if (score === undefined) return 'unknown'
  if (score >= CLINICAL_THRESHOLDS.REVEL.pathogenic.supporting) return 'pathogenic'
  if (score <= CLINICAL_THRESHOLDS.REVEL.benign.supporting) return 'benign'
  return 'uncertain'
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-fetch package | Native fetch (Node.js 18+) | Node.js 18 (2022), stable in 21 (2023) | Eliminates dependency, uses high-performance Undici under the hood |
| Manual type validation | Zod runtime validation | 2020+ | Catches API format changes at runtime, automatic TypeScript inference |
| axios for HTTP | Native fetch | 2023+ | Fetch is now standard across browser/Node/Deno, Axios still valid for complex needs |
| VEP canonical transcript | MANE Select transcript | MANE v1.0 (2022) | MANE Select is clinically preferred, 99% coverage of protein-coding genes |
| CADD-only scoring | Multi-tool ensemble (CADD, REVEL, SpliceAI) | ACMG 2015, updated 2023 | Evidence strength now scalable from Supporting to Strong based on calibration |
| Global rate limiting config | Per-service Bottleneck instances | 2018+ | Each API has different limits, isolated scheduling prevents cross-service interference |

**Deprecated/outdated:**
- **request package:** Deprecated in 2020, use native fetch or axios
- **node-fetch:** Still works but native fetch is preferred in Node.js 18+
- **VEP v2 API:** Use v3 API (POST vep/:species/region returns more fields)
- **Canonical transcript flag alone:** Always check for MANE Select first, fall back to canonical

## Open Questions

Things that couldn't be fully resolved:

1. **VEP Plugin Parameters**
   - What we know: CADD, REVEL, SpliceAI, AlphaMissense available as query parameters
   - What's unclear: Exact JSON response field names when plugins are enabled (documentation shows example but not full schema)
   - Recommendation: Test with real API calls during implementation, inspect response structure, build Zod schema iteratively. Consider using `z.record(z.unknown())` for plugin fields initially, refine as structure becomes clear.

2. **HPO API Rate Limits**
   - What we know: NLM Clinical Tables API documentation doesn't specify rate limits
   - What's unclear: Whether unspecified limits exist, appropriate courtesy throttling
   - Recommendation: Implement conservative throttling (e.g., 5 req/sec) as courtesy, monitor for errors. Email NLM support (clinicaltables-list@nlm.nih.gov) to request official rate limit documentation.

3. **Offline Detection Reliability**
   - What we know: `net.isOnline()` can return false positives (e.g., virtualization software with always-connected adapters)
   - What's unclear: Best practice for reliable offline detection in Electron main process
   - Recommendation: Combine `net.isOnline()` with actual API health check (HEAD request to known endpoint with 5s timeout). If net.isOnline() true but health check fails, treat as offline.

4. **Cache Size Management**
   - What we know: 30-day TTL for both VEP and HPO cache, periodic cleanup removes expired entries
   - What's unclear: Maximum safe cache size before performance degrades, whether to implement LRU eviction
   - Recommendation: Monitor cache size in production. If exceeds 10k entries or 100MB, implement LRU eviction combined with TTL. Use `SELECT COUNT(*), SUM(LENGTH(response_data))` query to track size.

## Sources

### Primary (HIGH confidence)
- [Ensembl REST API Documentation](https://rest.ensembl.org/) - Official VEP endpoints, version 15.10 (January 2026)
- [Ensembl REST Rate Limits Wiki](https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits) - Official rate limit policy, retry headers
- [NLM Clinical Tables HPO API Documentation](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html) - Official HPO autocomplete endpoint
- [Electron Online/Offline Event Detection](https://www.electronjs.org/docs/latest/tutorial/online-offline-events) - Official net.isOnline() documentation
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/api/ipc-main) - ipcMain.handle() async pattern
- [Node.js Fetch Documentation](https://nodejs.org/en/learn/getting-started/fetch) - Native fetch API in Node.js 18+
- [Zod Documentation](https://zod.dev/) - TypeScript-first schema validation
- [Bottleneck npm package](https://www.npmjs.com/package/bottleneck) - Rate limiting library documentation
- [better-sqlite3 Performance Guide](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) - WAL mode concurrency
- [NCBI RefSeq MANE Documentation](https://www.ncbi.nlm.nih.gov/refseq/MANE/) - MANE Select transcript standard

### Secondary (MEDIUM confidence)
- [Franklin Help Center - Prediction Tools PP3/BP4](https://help.genoox.com/en/articles/6240723-prediction-tools-pp3-bp4) - Clinical thresholds (Pejaver et al. 2022 calibration study)
- [Bioinformatics: Improved VCF normalization](https://academic.oup.com/bioinformatics/article/33/7/964/2623048) - Variant normalization best practices
- [SQLite Performance Tuning (phiresky's blog)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) - Cache optimization patterns
- [Exponential Backoff and Jitter (Tyler Crosse)](https://www.tylercrosse.com/ideas/2022/exponential-backoff) - Backoff algorithm with jitter
- [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) - Fetch cancellation patterns
- [Axios vs Fetch comparison (iproyal.com)](https://iproyal.com/blog/axios-vs-fetch/) - HTTP client library comparison 2026
- [Nock GitHub Repository](https://github.com/nock/nock) - HTTP mocking for tests

### Tertiary (LOW confidence)
- WebSearch results for VEP response format with CADD/REVEL/SpliceAI fields - need verification with actual API calls
- Community discussions on VEP API timeout issues (GitHub issues) - specific limits (50 variants) need testing
- Blog posts on cache-key generation - general principles valid, specific implementation varies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native fetch, Bottleneck, Zod are well-documented and widely used in 2026
- Architecture: HIGH - Patterns verified from official Electron, Node.js, and library documentation
- Pitfalls: MEDIUM - Derived from GitHub issues and community experience, need validation in Varlens context
- Clinical thresholds: MEDIUM - Based on peer-reviewed publications (Pejaver 2022, Walker 2023) but values vary by expert panel

**Research date:** 2026-01-28
**Valid until:** ~2026-02-28 (30 days for stable technologies, VEP API format may change with Ensembl releases)

**Verification needed:**
- Exact VEP JSON response structure with all plugins enabled (test with real API calls)
- HPO API rate limits (contact NLM support)
- Cache size performance characteristics (monitor in production)
