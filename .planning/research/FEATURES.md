# Feature Landscape

**Domain:** Genetic variant analysis desktop tool (cohort analysis, batch import, external links, database encryption)
**Researched:** 2026-01-27
**Applies to:** v0.3.0 milestone

## Table Stakes

Features users expect for these capabilities. Missing = product feels incomplete or unprofessional.

### Cohort Analysis

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Aggregated variant table across all cases | Core purpose of cohort analysis; every cohort tool (IVA, VarSeq, ICA) has this | High | Existing cases/variants schema | Must aggregate by chr+pos+ref+alt across all cases. New SQL view or query, not new table. Performance-critical for large cohorts |
| Carrier count per variant | Standard metric in all cohort tools (gnomAD, Genomics England AVT, Golden Helix VarSeq). "How many cases have this variant?" | Medium | Aggregated variant query | COUNT of distinct cases where variant appears. Display as N/total |
| Allele frequency within cohort | Expected alongside carrier count. AF = allele_count / (2 * total_cases) assuming diploid | Medium | Carrier count | Requires genotype awareness: het contributes 1, hom_alt contributes 2. Existing `gt_num` field ("0/1", "1/1") supports this |
| Het/Hom breakdown | Genomics England IVA and AVT both show this. Clinicians need to see if carriers are heterozygous vs homozygous | Medium | Carrier count, gt_num field | Parse gt_num: "0/1" = het, "1/1" = hom_alt. Display as "3 het / 1 hom" |
| Per-case links from cohort view | Users need to drill down from aggregated variant to individual cases that carry it | Medium | Aggregated variant query | Click on carrier count to see which cases. Could be expandable row or dialog |
| Cohort variant search | Users expect to search/filter the aggregated view just like single-case view | Medium | Aggregated variant table, existing FTS5 | Reuse filter patterns from single-case view. Gene symbol, consequence, gnomAD AF, CADD |
| Gene-level aggregation | VarSeq Count Alleles and Genomics England AVT both offer gene-level summaries. "How many carriers have ANY variant in this gene?" | High | Aggregated variant query | GROUP BY gene_symbol across all cases. More complex than variant-level: need to avoid double-counting cases with multiple variants in same gene |

### Batch Import

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Multi-file picker (select multiple .json.gz files) | Natural extension; any batch tool supports this. Electron `dialog.showOpenDialog` with `multiSelections: true` | Low | Existing import pipeline | Already have single-file import. Multi-file = loop + queue. Must auto-derive case name per file |
| Import progress per file and overall | Users need to know which file is being processed and total progress | Medium | Existing progress UI | Need two-level progress: "File 3 of 12" + per-file variant progress |
| Sequential processing with error isolation | One failed file must not abort remaining imports. VarSeq handles this gracefully | Medium | Multi-file picker | Try/catch per file, collect results, show summary at end |
| Import summary report | Show results for all files: success count, failure count, per-file details | Low | Sequential processing | Summary dialog after batch completes |
| Duplicate case name handling | When importing 12 files, name collisions are likely. Must handle gracefully | Low | Existing UNIQUE constraint on case name | Auto-suffix with counter: "case-892 (2)" or skip with warning |

### External Links

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| gnomAD link per variant | Standard in every variant analysis tool (VEP, VarSome, UCSC, VGC). gnomAD is THE population frequency reference | Low | Existing chr, pos, ref, alt fields | URL pattern: `https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}`. Verified: gnomAD browser uses `{chr}-{pos}-{ref}-{alt}` format. Optional `?dataset=gnomad_r4` parameter for version |
| ClinVar link per variant | Every clinical variant tool links to ClinVar. Users expect to click through to full ClinVar record | Low | Existing chr, pos, ref, alt fields | URL pattern: `https://www.ncbi.nlm.nih.gov/clinvar/?term={chr}:{pos}:{ref}:{alt}` (search-based). Or if ClinVar VCV ID is available, `https://www.ncbi.nlm.nih.gov/clinvar/variation/{VCV_ID}`. Since Varlens stores ClinVar classification but not VCV ID, use search-based URL |
| OMIM link per gene | Clinicians routinely check OMIM for gene-disease associations | Low | Existing gene_symbol field | URL pattern: `https://www.omim.org/search?search={gene_symbol}`. Direct MIM number link would be `https://www.omim.org/entry/{MIM_number}` but requires MIM number mapping |
| Link opens in default browser | Electron security: external links must open in system browser, never in Electron webview | Low | Existing shell.openExternal API | Already have ShellAPI with `openExternal`. Well-established pattern |
| Links as icon buttons in table row | Standard UX in variant tables: small clickable icons per row, not cluttering text display | Low | VariantTable component | Add icon column(s) or action column with mdi-open-in-new icons |

### Database Encryption (SQLCipher)

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Database password prompt on app open | If database is encrypted, user must enter password before accessing data. Standard for any encrypted local database app | Medium | SQLCipher integration | Show password dialog before initializing DatabaseService. Wrong password = error + retry |
| Create new encrypted database | Users need to be able to create a new database with a password | Medium | SQLCipher integration | Password + confirmation fields. Store nothing about the password |
| Open existing encrypted database | Enter password to decrypt and use existing database | Medium | SQLCipher integration, database file selection | PRAGMA key = 'passphrase' on open. If wrong key, SQLCipher returns "file is not a database" error |
| Change database password | Standard security feature. SQLCipher supports `PRAGMA rekey` | Low | Encrypted database open | Settings dialog with current password + new password + confirm. Use `PRAGMA rekey` |

### Database Selection/Switching

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| File picker to select database file | Reference project sqlite-search uses this pattern. Users need to choose which database to work with | Medium | Electron dialog API | `dialog.showOpenDialog` with `.sqlite` / `.db` filter. Must close current DB connection and open new one |
| Create new database | Users need ability to create fresh databases | Low | Database initialization | `dialog.showSaveDialog` for new file path. Initialize schema on new DB |
| Recent databases list | Convenience feature users expect. Avoids re-browsing every time | Medium | Electron persistent storage | Store list of recently-opened DB paths. Use electron-store or simple JSON in userData |
| Current database indicator | Users must know which database is active | Low | Database selection state | Display file name or path in app header/footer |

### Password-Protected ZIP Import

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Extract .json.gz files from password-protected ZIP | Project requirement for secure data distribution | Medium | adm-zip or unzipper library | adm-zip supports password-protected ZIPs and has Electron-specific `fs` option. Extract to temp dir, then import normally |
| Password prompt for ZIP files | User provides ZIP password, distinct from database password | Low | ZIP extraction | Simple password dialog before extraction |
| Cleanup extracted temp files | Security: don't leave unencrypted data on disk | Low | Temp directory management | Extract to `app.getPath('temp')`, delete after import completes |

## Differentiators

Features that set Varlens apart from competitors. Not expected in every tool, but add significant value for this user base (external collaborators analyzing cohorts offline).

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| OMIM disease associations from annotation data | Go beyond link-out: show disease names and inheritance modes directly in the variant table. Most desktop tools only link out; showing OMIM data inline saves context-switching | Medium | gene_symbol field, OMIM data mapping | Could parse from existing `moi` (mode of inheritance) field. Or add new field from import data. Need OMIM gene-to-phenotype mapping (mim2gene.txt is freely downloadable). Alternatively, if annotation pipeline already includes OMIM data, surface it from existing fields |
| Cohort-level gene burden view | Beyond variant-level: show genes ranked by number of carriers. "Which genes have the most affected individuals?" This is a research-grade feature from tools like VARPRISM and Golden Helix | High | Gene-level aggregation, cohort analysis | SQL: `SELECT gene_symbol, COUNT(DISTINCT case_id) as carrier_count FROM variants WHERE ... GROUP BY gene_symbol ORDER BY carrier_count DESC`. Powerful for gene discovery |
| Folder import (drag-and-drop or folder picker) | Beyond multi-file: point at a folder, import all .json.gz files recursively. Powerful for batch workflows | Low | Multi-file import | Electron `dialog.showOpenDialog` with `properties: ['openDirectory']`. Scan for .json.gz files. Also enables drag-and-drop UX |
| Affected/Unaffected split in cohort stats | Genomics England AVT distinguishes affected vs unaffected carriers. If case metadata includes affected status, can split carrier counts | High | Case metadata extension, cohort analysis | Requires adding `affected_status` to cases table. Not in current schema. Defer unless annotation data includes this |
| Offline OMIM data bundle | Ship OMIM gene-to-disease mapping with the app so external links and disease associations work fully offline | Medium | OMIM data licensing | mim2gene.txt is free to download from OMIM. Could bundle a curated gene-disease table. Requires periodic updates |
| Cross-case variant comparison matrix | Side-by-side view of selected cases showing which variants each case has. Heat-map style grid | High | Cohort analysis | Complex UI. Probably v0.4+ territory. Mentioned in Lasergene Genomics and SCI-VCF |
| Combined encryption: encrypted database + encrypted import ZIP | End-to-end encryption story: data encrypted in transit (ZIP) and at rest (SQLCipher). Compelling for sensitive genetic data | Low (additive) | ZIP import + SQLCipher | Both features combined provide strong security narrative. No extra code, just marketing/documentation |

## Anti-Features

Features to explicitly NOT build in v0.3.0. Common mistakes in this domain that would add complexity without proportional value.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full VCF import parser | VCF parsing is a massive rabbit hole (multi-sample VCF, structural variants, INFO field parsing, FORMAT field parsing). Varlens uses pre-annotated JSON, which is the right abstraction | Keep JSON-only import. VCF is explicitly out of scope per PROJECT.md |
| Real-time cohort statistics dashboard with charts | Charting libraries add bundle size and complexity. Cohort stats as numbers in a table are more actionable than pie charts for clinical genetics | Show cohort stats as a well-formatted data table. Defer charts to v0.4+ if users request them |
| Multi-user access / database sharing | SQLite is single-writer. Adding multi-user access would require a server component, violating the offline-first architecture | Keep single-user offline model. If sharing is needed, export/import databases |
| Live ClinVar/gnomAD data fetching | Fetching live data from external APIs contradicts the offline-first design. Network failures would break core functionality | Use link-out pattern: open in browser. User can check live data when online |
| Automatic OMIM data updates | Auto-updating OMIM data requires network access and OMIM API registration. Overcomplicates offline tool | Bundle a static OMIM mapping. Document how to update manually. Or derive OMIM data from annotation pipeline output |
| Database migration between encrypted and unencrypted | Converting existing unencrypted database to encrypted (or vice versa) is complex with SQLCipher. Requires creating new DB, copying all data, swapping files | Create new encrypted databases. Import existing data into new encrypted DB via the import pipeline. Document this workflow |
| User-configurable encryption cipher | better-sqlite3-multiple-ciphers supports 6 cipher schemes. Exposing cipher choice to users adds confusion for zero benefit | Default to SQLCipher compatibility (most widely used) or ChaCha20-Poly1305 (recommended by SQLite3MultipleCiphers). Hard-code the choice |
| Variant-level annotation editing | Users should not modify annotation data in the database. This is a read-only analysis tool, not a curation platform | Keep database read-only after import. If re-annotation is needed, re-import from updated source data |
| CNV/SV analysis in cohort view | Structural variants require fundamentally different aggregation logic (overlap-based, not exact match). Current schema is SNV/indel focused | Keep cohort analysis SNV/indel focused. CNV/SV is explicitly out of scope per PROJECT.md |
| Export cohort data to multi-sample VCF | VCF generation from internal representation is complex and error-prone. Not the right export format for this tool | Export cohort results as TSV/Excel (already have xlsx dependency). Users can post-process as needed |

## Feature Dependencies

```
Batch Import Path:
  Multi-file picker --> Sequential processing --> Import summary report
                    --> Duplicate name handling
  Folder import --> Multi-file picker (reuses same queue)
  ZIP extraction --> Password prompt --> Temp file cleanup --> Multi-file picker

Database Path:
  better-sqlite3-multiple-ciphers integration --> Database password prompt
                                              --> Create new encrypted DB
                                              --> Open existing encrypted DB
                                              --> Change password
  File picker for DB selection --> Recent databases list
                               --> Current DB indicator
  DB selection + encryption = combined flow (select file, then enter password)

External Links Path:
  URL pattern configuration --> gnomAD link (chr-pos-ref-alt)
                           --> ClinVar link (search-based)
                           --> OMIM link (gene search)
  shell.openExternal (already exists) --> All links

Cohort Analysis Path:
  Cross-case aggregation query --> Aggregated variant table
                               --> Carrier count
                               --> Allele frequency
                               --> Het/Hom breakdown
  Aggregated variant table --> Cohort variant search (reuse filter patterns)
                           --> Per-case drill-down links
  Gene-level aggregation --> Gene burden view (differentiator)

OMIM Disease Associations:
  gene_symbol field --> OMIM gene-to-phenotype lookup
                    --> Disease name display in variant row
  Depends on: OMIM data source (bundled mapping or parsed from annotation)
```

## Implementation Ordering Rationale

The dependency graph suggests this implementation order:

1. **External Links** (LOW complexity, no schema changes, immediate user value)
   - gnomAD, ClinVar, OMIM links are stateless URL generation
   - Depends only on existing data (chr, pos, ref, alt, gene_symbol)
   - Can ship independently of all other features

2. **Database Selection/Switching** (MEDIUM complexity, foundational for encryption)
   - Must work before encryption (encrypted DB selection requires file picker)
   - Reference project sqlite-search provides pattern
   - Changes to DatabaseService lifecycle (close/reopen)

3. **Database Encryption** (MEDIUM-HIGH complexity, migration from better-sqlite3)
   - Replace `better-sqlite3` with `better-sqlite3-multiple-ciphers`
   - Password prompt UI, encrypted DB creation flow
   - Must validate rebuild process works on all platforms (Windows, macOS, Linux)
   - RISK: Native module rebuild is the hardest part

4. **Batch Import** (MEDIUM complexity, extends existing working pipeline)
   - Existing ImportService handles single file well
   - Multi-file is a queue around existing pipeline
   - ZIP extraction adds one preprocessing step
   - Low risk since core pipeline is proven

5. **OMIM Disease Associations** (MEDIUM complexity, data mapping)
   - Depends on understanding annotation data structure
   - May need bundled OMIM mapping data
   - Can start once external links pattern is established

6. **Cohort Analysis** (HIGH complexity, new views and queries)
   - Most complex feature set
   - New aggregation queries, new UI views
   - Should come last when all import features are solid (need multiple cases in DB)
   - Performance testing needed for large cohorts

## MVP Recommendation

For v0.3.0 MVP, prioritize in this order:

**Must ship (table stakes for v0.3.0 value proposition):**
1. External links (gnomAD, ClinVar, OMIM) -- immediate value, low risk
2. Batch import (multi-file picker + sequential processing) -- enables cohort use case
3. Database selection/switching -- foundational infrastructure
4. Cohort aggregated variant table with carrier count and het/hom breakdown -- the headline feature
5. Cohort variant search -- makes cohort view usable

**Should ship (complete the story):**
6. Database encryption (SQLCipher via better-sqlite3-multiple-ciphers) -- security promise
7. Password-protected ZIP import -- completes security story
8. OMIM disease associations -- clinical value-add
9. Gene-level aggregation in cohort view -- research value-add
10. Per-case drill-down from cohort view -- cohort usability

**Defer to post-v0.3.0:**
- Affected/unaffected cohort split (requires schema extension for case metadata)
- Cross-case comparison matrix (complex UI, v0.4+)
- Cohort statistics charts (numbers in table sufficient for now)
- Folder import with drag-and-drop (nice-to-have, multi-file picker sufficient)

## Technical Considerations

### SQLCipher Migration Risk

The migration from `better-sqlite3` to `better-sqlite3-multiple-ciphers` is the highest-risk technical change in v0.3.0. Key concerns:

- **Package:** `better-sqlite3-multiple-ciphers` (v12.5.0) is the recommended choice. It closely tracks upstream `better-sqlite3` (currently v12.6.2) and is actively maintained. The older `better-sqlite3-sqlcipher` package is abandoned (last update 6 years ago, stuck at v5.4.3).
- **API compatibility:** `better-sqlite3-multiple-ciphers` is a drop-in replacement for `better-sqlite3`. Same API, same TypeScript types. Encryption is activated via PRAGMA statements after opening.
- **Rebuild:** Requires `@electron/rebuild` (already in devDependencies). Prebuilt binaries exist for Electron. The existing `postinstall` script pattern (`npx @electron/rebuild -f -w better-sqlite3`) should work with `-w better-sqlite3-multiple-ciphers`.
- **Platform risk:** Native module compilation on Windows requires Visual Studio Build Tools (documented in CLAUDE.md). Cross-platform CI already handles this.
- **Backwards compatibility:** Unencrypted databases work without any PRAGMA. Encrypted databases require `PRAGMA key='...'` before any query. The app must handle both modes.

### Cohort Aggregation Performance

Aggregating variants across many cases will be the most expensive query. With 10 cases of 65k variants each (650k total rows), GROUP BY on chr+pos+ref+alt could be slow without proper indexing.

- **Index needed:** Composite index on `(chr, pos, ref, alt)` for aggregation. The existing `idx_variants_pos` covers `(chr, pos)` but not ref+alt.
- **Materialized view consideration:** For large cohorts, pre-computing aggregation results on import could improve query performance. However, this adds complexity and stale-data risk.
- **Recommendation:** Start with live queries + proper indexing. Only add materialized views if performance is unacceptable in testing.

### External URL Patterns (Verified)

| Database | URL Pattern | Source Confidence |
|----------|-------------|-------------------|
| gnomAD | `https://gnomad.broadinstitute.org/variant/{chr}-{pos}-{ref}-{alt}` | HIGH -- verified from gnomAD browser documentation and community usage. Optionally add `?dataset=gnomad_r4` for v4 |
| ClinVar (search) | `https://www.ncbi.nlm.nih.gov/clinvar/?term={chr}:{pos}:{ref}:{alt}` | HIGH -- verified from ClinVar search help documentation. Supports GRCh37/38 format |
| ClinVar (direct) | `https://www.ncbi.nlm.nih.gov/clinvar/variation/{VCV_ID}` | HIGH -- verified, but requires VCV ID which Varlens does not currently store |
| OMIM (gene search) | `https://www.omim.org/search?search={gene_symbol}` | MEDIUM -- OMIM search works, but gene symbol may match multiple entries |
| OMIM (direct entry) | `https://www.omim.org/entry/{MIM_number}` | HIGH -- verified, but requires MIM number mapping |
| UCSC Browser | `https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=chr{chr}:{pos}-{pos}` | HIGH -- standard UCSC URL pattern |
| Ensembl | `https://www.ensembl.org/Homo_sapiens/Variant/Explore?v={chr}_{pos}_{ref}/{alt}` | MEDIUM -- Ensembl uses rsID or custom variant format, verify before implementing |

**Recommendation:** Start with gnomAD and ClinVar (most commonly used by clinicians). Add OMIM gene link. Defer UCSC/Ensembl to later if users request them.

## Sources

- [gnomAD Browser](https://gnomad.broadinstitute.org/) -- variant URL patterns, allele frequency reference
- [ClinVar Search Help](https://www.ncbi.nlm.nih.gov/clinvar/docs/help/) -- search URL query formats
- [OMIM External Links](https://www.omim.org/help/external) -- URL patterns and MIM number system
- [Golden Helix VarSeq](https://www.goldenhelix.com/products/VarSeq/) -- cohort analysis Count Alleles algorithm
- [Genomics England IVA](https://re-docs.genomicsengland.co.uk/iva_variant/) -- cohort variant stats, het/hom breakdown
- [Genomics England AVT](https://re-docs.genomicsengland.co.uk/avt/) -- aggregate variant testing, dominant/recessive modes
- [Illumina Connected Analytics](https://help.ica.illumina.com/project/p-cohorts/cohorts-analysis) -- cohort analysis patterns
- [Euformatics Genomics Hub](https://www.euformatics.com/feature-update/cohort-analysis-in-the-context-of-clinical-genomics-variant-interpretation/) -- cohort-based variant analysis
- [better-sqlite3-multiple-ciphers (npm)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers) -- SQLCipher integration package
- [better-sqlite3-multiple-ciphers (GitHub)](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) -- Electron support, cipher options
- [SQLite3MultipleCiphers](https://utelle.github.io/SQLite3MultipleCiphers/) -- cipher scheme documentation
- [adm-zip (npm)](https://www.npmjs.com/package/adm-zip) -- password-protected ZIP extraction
- [sqlite-search (GitHub)](https://github.com/berntpopp/sqlite-search) -- database selection/switching reference
- [SCI-VCF](https://academic.oup.com/nargab/article/6/3/lqae083/7709543) -- cross-platform VCF GUI tool
- [Variant Graph Craft (VGC)](https://bmcbioinformatics.biomedcentral.com/articles/10.1186/s12859-024-05875-7) -- cohort variant visualization
