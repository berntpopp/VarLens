# 10 · Genome build: suggest, then confirm

Design for audit item I-P2-3 (`04-cohort-import-settings.md:88`, `08d` item 16), widened to every import flow.
It is the prerequisite for the per-build chromosome normalisation in `09-chr-normalisation-and-cohort-denominator.md`.
Code read at `04c4db09`. Read only. Nothing here is implemented.

**Goal.** Every case is stored with a build that came from evidence or from an explicit user choice, never from a silent `'GRCh38'` default.
The build drives the stored chromosome names (09), `chrM` vs `MT`, cohort keys, panels and external links.

**Product-owner rule.** Build data lives in one typed config, `src/shared/config/genome-builds.config.ts`: ids, aliases, contig lengths, mito rules, header-tag line prefixes, the confidence each evidence source can reach, and UI copy.
It is exported from `src/shared/config/index.ts` next to `DOMAIN_CONFIG`.
Both `detectGenomeBuild()` and 09's `canonicalContig()` read it, and the tests are table-driven from it.
**Adding a build such as T2T-CHM13 is a config-only change.**

---

## 1. Current state

### 1.1 Detection: one function, header only
`src/main/services/GenomeBuildDetector.ts:24-55` `detectGenomeBuildFromVcfHeaders(headerLines)` returns `'GRCh37' | 'GRCh38' | null`.

| Gap | Where | Effect |
|---|---|---|
| String evidence outranks length evidence | `:26-36`, before `:39` | A `##reference=` path wins over contig lengths, which is the wrong order. |
| The GRCh38 substring is tested first on each line | `:30` vs `:33` | `##reference=…/hg19ToHg38.over.chain` → GRCh38. This is right for a liftover by luck and wrong in the general case. |
| Common reference names are missed | `:30,33` | `Homo_sapiens_assembly38.fasta` and `…assembly19.fasta` (GATK bundle), `hs38DH`, `human_g1k_v37`, `b37` all return null. |
| `##contig=<…,assembly=…>` is ignored | — | Our own fixtures say `assembly=human_GRCh38_no_alt_analysis_set.fasta`. |
| VEP, SnpEff and caller headers are ignored | — | `##VEP=… cache=…/115_GRCh38`, `##VEP-command-line=… --assembly GRCh38` and `##SnpEffCmd=… GRCh38.mane.1.2.ensembl` are in every annotated fixture (`tests/test-data/vcf/*.vep.vcf.gz`, `*.snpeff.vcf.gz`) and unused. |
| Only `chr1`/`1` is checked | `:43` | A chr22-only panel VCF with a full header still has 24 other discriminating lengths, but a header without chr1 yields nothing. |
| No exclusion, no confidence, no evidence | — | The UI cannot say *why*. Positions are never checked against contig lengths. |

`vcf-header-parser.ts:226-227` stores the result as `header.genomeBuild`.
`vcf-preview.ts:88` returns it as `detectedGenomeBuild` (`src/shared/types/vcf.ts:24`, `src/shared/types/import.ts:86`).

### 1.2 What each flow shows and stores

| Flow | UI | What reaches the case row |
|---|---|---|
| **Single VCF** (`ImportWizard` → `VcfPreviewStep`) | `v-select` with options `['GRCh38','GRCh37']` hard-coded (`VcfPreviewStep.vue:149`), default `ref('GRCh38')` (`:146`). The hint is always **"Auto-detected from VCF header. Override if incorrect."** (`:38`), **even when nothing was detected**. On detection it is overwritten (`:215-216`). | `vcfGenomeBuild` (`ImportWizard.vue:246`, reset to `'GRCh38'` at `:734`) → `vcfOptions.genomeBuild`. |
| **Multi-file, one case** (`VcfImportDialog`) | **No build control at all.** Per-file info chip only when detected (`VcfFileList.vue:64-72`). | Sends `files[0].detectedGenomeBuild` or `undefined` (`VcfImportDialog.vue:626-631`). The worker then defaults to GRCh38 (`import-worker.ts:196`). |
| **Batch** (files, folder, zip; **every JSON import**, because one non-VCF file also takes this path: `ImportWizard.vue:456-465`) | No build control. | `batchImport.start(paths, strategy, strip, runId)` (`src/shared/types/api.ts:399-404`) carries no build, so **every case is GRCh38**, including GRCh37 VCFs whose header declares it. |
| **Web** | Same renderer components. `import:vcfPreview` is `sharedRead` (`parity-manifest/core.ts:50`, `src/web/server/routes/import.ts:34`). | PG worker defaults: `postgres-import-worker.ts:267,492,543` `?? 'GRCh38'`. |

**Storage.**
- SQLite: `cases.genome_build TEXT DEFAULT 'GRCh38'` (`migrations.ts:1218`).
- PG: `0001_create_cases.sql:8` `NOT NULL DEFAULT 'GRCh38'`.
- Repository default: `CaseRepository.ts:36` `genomeBuild = 'GRCh38'`.
- The build cannot be edited after import (no write path to `cases.genome_build`).

**Multi-file lock (latent bug).**
1. `import-logic.ts:351-358` falls back to reading the case row back when the wizard sent no build. The row holds the worker's default GRCh38.
2. `assertGenomeBuildMatches` (`vcf-header-parser.ts:324-335`) then rejects a later file that *does* declare GRCh37, with "case is locked to GRCh38", although nobody chose GRCh38.
3. A file that declares nothing always passes.

---

## 2. VNtyper prior art: what to reuse

| Source | What it does | Reuse? |
|---|---|---|
| `vntyper-online-frontend/resources/js/bamProcessing.js:503-760` `detectAssembly` | Three methods: @PG context strings, chr1 length, ≥90 % contig name+length match. Then a 7-row consensus table (VERY HIGH … LOW). **Chromosome data beats @PG strings on conflict** (`:670-686`). | **Yes:** the ordering rule and "lengths win". **No:** the 7 levels. Three levels are enough for a confirm UI. |
| `bamProcessing.js:314-488` `extractAssemblyFromHints` | Alias table (`hs37d5`, `hs38DH` …) plus ±100-character context scoring. A positive score for `--ref`; a negative one for `--skip-contigs` / `--decoy`. | **Yes:** the alias list. **No:** context weights. VCF header tags are structured (`cache=`, `--assembly`, `assembly=`), so the line prefix is the context. |
| `bamProcessing.js:140-260` `detectNamingConvention` | `ucsc` / `ensembl` / `ncbi` via a ≥50 % regex majority on the main contigs. It maps build + convention to `hg19`/`GRCh37`/`hg19_ncbi`. | **Partly.** In VarLens naming is never evidence of the build (09 normalises it away). Keep it only as a display fact. |
| `assemblyConfigs.js` | Per-assembly contig name+length tables as plain data. | **Yes:** the "lengths are data, not code" shape. That is the product-owner rule. |
| `VNtyper/vntyper/scripts/assembly_guard.py:1-60,156` `reconcile_assembly` | Pure and never raises. Verdict `agree / mismatch / conflict / undetermined`. **`conflict` = two aliases of chr1 carry different known lengths**, which is a defect in the input, not an open question. | **Yes:** the pure verdict + separate policy split, and `conflict` as its own state. |
| `pipeline_guards.py:8-20` | Policy: a decided disagreement stops the run. Undetermined warns and continues. | **Yes, adapted:** a decided disagreement **blocks**. Undetermined **asks** (VarLens has a human in the loop). |
| `uiUtils.js:432-456` `createAssemblyMessageHTML` | Always shows a banner: "Detected reference assembly: X … Please confirm or select manually." | **Yes, the principle:** always show what was detected. **No:** the big banner (dense UI rule). |
| `reference_resolution.py` | Resolves FASTA paths per assembly label with an exact / physical-id / UCSC-family fallback. | No. VarLens holds no FASTA. |

---

## 3. Detection algorithm

### 3.1 Config: `src/shared/config/genome-builds.config.ts`

```ts
export interface GenomeBuildDef {
  id: string                        // 'GRCh38' — stored in cases.genome_build
  label: string                     // 'GRCh38 (hg38)'
  importable: boolean               // false = recognised, but import is blocked (T2T today)
  aliases: string[]                 // lower-case tokens matched in header tags
  primaryPrefix: 'chr' | ''         // 09: stored form of 1..22,X,Y
  mito: { canonical: string; lengths: Record<string, number> } // 'chrM' | 'MT'; name -> length.
                                    // Detection uses only the set of lengths; 09 uses the names.
  contigs: Record<string, number>   // bare primary name -> length ('1'..'22','X','Y')
}
export const GENOME_BUILDS: readonly GenomeBuildDef[]
export const BUILD_TAG_SOURCES: readonly { prefix: string; label: string }[]
  // '##reference=' 'Reference', '##assembly=' 'Assembly', '##contig=' 'Contig assembly',
  // '##VEP=' 'VEP cache', '##VEP-command-line=' 'VEP', '##SnpEffCmd=' 'SnpEff',
  // '##GATKCommandLine' 'GATK', '##DRAGENCommandLine' 'DRAGEN', '##bcftools_' 'bcftools'
export const LIFTOVER_MARKERS: readonly string[] // '##liftOverProgram', '##targetRefGenome', '.over.chain', 'chain='
export const BUILD_COPY: { … }                   // UI strings, see §4.2
```

The evidence ranking (lengths = definitive, tags = strong, positions = exclude only) is **not** a config value. The decision rules in §3.3 are written against that order, so a config knob could not change it without changing code; it would only pretend to. It is a doc comment in the config file. Everything that *can* vary per build or per tool (aliases, lengths, tag prefixes, liftover markers, copy) is config data.

**Alias matching.** Lower-case the line. An alias matches when it is not preceded by `[a-z0-9]` and not followed by a digit. So `115_grch38`, `grch38.mane.1.2` and `homo_sapiens_assembly38` match, and `hg19tohg38` matches only `hg19`.
This is the reason for the liftover rule below.

| Build | `aliases` (seed list; extend from real files) |
|---|---|
| GRCh37 | `grch37`, `hg19`, `hs37d5`, `hs37`, `b37`, `human_g1k_v37`, `homo_sapiens_assembly19`, `grch37lite` |
| GRCh38 | `grch38`, `hg38`, `hs38dh`, `hs38`, `b38`, `homo_sapiens_assembly38`, `gca_000001405.15` |
| CHM13 (T2T) | `chm13`, `t2t`, `hs1` — `importable: false` |

### 3.2 Contig lengths (the config data)

These come from the UCSC chrom.sizes files. The GRCh38 lengths match our fixture header (`single-sample.vcf.gz`) and VNtyper's `assemblyConfigs.js`. hg19 and GRCh37 share every primary length; only the mito differs.

| Contig | GRCh37 / hg19 | GRCh38 | T2T-CHM13v2.0 |
|---|---|---|---|
| 1 | 249,250,621 | 248,956,422 | 248,387,328 |
| 2 | 243,199,373 | 242,193,529 | 242,696,752 |
| 3 | 198,022,430 | 198,295,559 | 201,105,948 |
| 4 | 191,154,276 | 190,214,555 | 193,574,945 |
| 5 | 180,915,260 | 181,538,259 | 182,045,439 |
| 6 | 171,115,067 | 170,805,979 | 172,126,628 |
| 7 | 159,138,663 | 159,345,973 | 160,567,428 |
| 8 | 146,364,022 | 145,138,636 | 146,259,331 |
| 9 | 141,213,431 | 138,394,717 | 150,617,247 |
| 10 | 135,534,747 | 133,797,422 | 134,758,134 |
| 11 | 135,006,516 | 135,086,622 | 135,127,769 |
| 12 | 133,851,895 | 133,275,309 | 133,324,548 |
| 13 | 115,169,878 | 114,364,328 | 113,566,686 |
| 14 | 107,349,540 | 107,043,718 | 101,161,492 |
| 15 | 102,531,392 | 101,991,189 | 99,753,195 |
| 16 | 90,354,753 | 90,338,345 | 96,330,374 |
| 17 | 81,195,210 | 83,257,441 | 84,276,897 |
| 18 | 78,077,248 | 80,373,285 | 80,542,538 |
| 19 | 59,128,983 | 58,617,616 | 61,707,364 |
| 20 | 63,025,520 | 64,444,167 | 66,210,255 |
| 21 | 48,129,895 | 46,709,983 | 45,090,682 |
| 22 | 51,304,566 | 50,818,468 | 51,324,926 |
| X | 155,270,560 | 156,040,895 | 154,259,566 |
| Y | 59,373,566 | 57,227,415 | 62,460,029 |
| Mito | `MT` 16,569 (rCRS) · `chrM` **16,571** (hg19, NC_001807) | `chrM`/`MT` 16,569 | `chrM` 16,569 |

Every primary length differs across the three builds, so any single primary `##contig` with a length decides the build.
The mito length 16,569 decides nothing (it is shared). hg19 `chrM` 16,571 decides GRCh37.
The md5 / refget digests (`##contig=<…,md5=…>`) would be stronger still, but they are rare in VCFs, and the lengths already discriminate the primaries. So md5 is skipped (§6).

### 3.3 `detectGenomeBuild(headerLines, maxPos?)`: one pure function in `src/shared/genome/genome-build.ts`

```ts
type BuildConfidence = 'definitive' | 'strong' | 'conflict' | 'none'
interface BuildEvidence { build: string; source: string; detail: string } // detail is shown verbatim
interface BuildDetection { suggested: string | null; confidence: BuildConfidence
                           evidence: BuildEvidence[]; excluded: BuildEvidence[] }
function detectGenomeBuild(headerLines: string[], maxPos?: Record<string, number>): BuildDetection
function combineBuildDetections(perFile: BuildDetection[]): BuildDetection // multi-file case
```

Ordered evidence:

| # | Source | Reaches | Rule |
|---|---|---|---|
| 1 | `##contig=<ID,length>` for the primaries and mito. Name: strip `chr`, `M`→mito. | **definitive** | Per build: `match` = same name and same length; `mismatch` = same name, other length. A build is a **length candidate** when it has ≥1 match and 0 mismatches. A mismatch puts the build into `excluded`. |
| 2 | Header tags: lines starting with a `BUILD_TAG_SOURCES` prefix, alias tokens (§3.1) | **strong** | Collect the set of builds named. **Lines that contain a `LIFTOVER_MARKERS` token are skipped**, because they name the source build. |
| 3 | Max `POS` seen per primary contig (preview only) | **exclude only** | `maxPos[c] > build.contigs[c]` → `excluded`. It never suggests a build: an exclusion of GRCh38 is not evidence for GRCh37 (it could be T2T). |
| 4 | `chr` vs bare naming | — | **Not used.** GRCh38 is often bare (Ensembl), and GRCh37 is often `chr` (hg19). |

The decision (`L` = the single length candidate; `T` = the builds named by tags, minus `excluded`):

1. `L` exists and `T ⊆ {L}` → `definitive`, suggested `L`.
2. `L` exists and `T` names another build → `conflict`, suggested `L`. Lengths win, as in VNtyper, but the user confirms.
3. More than one length candidate, which only happens with mito-only evidence → treat as no `L`.
4. No `L` and length mismatches on two different builds → `conflict`, suggested null. The header lengths fit no single build.
5. No `L` and `|T| = 1` → `strong`, suggested `T`.
6. No `L` and `|T| > 1` → `conflict`, suggested null.
7. Otherwise → `none`, suggested null. Lengths that match no build (a custom reference) add an evidence line "Contig lengths match no known build".

A suggested build with `importable: false` keeps its confidence, but the UI blocks the import (§4.2).

`combineBuildDetections`:
- Distinct non-null `suggested` values across files → `conflict` (suggested null). Each file's evidence is kept, prefixed with the file name.
- One value → the weakest confidence of the files that have one. Files with `none` do not lower it.
- The `excluded` lists are unioned. If that excludes the suggestion → `conflict`.

**Where it runs.** It runs in main, at the three places that already parse the header:
- preview, with positions: `vcf-preview.ts:43-65`. The data-line branch adds `maxPos` tracking: two `indexOf('\t')` calls per line, ≤100k lines (`:18`);
- `parseVcfHeaderFromLines` (`vcf-header-parser.ts:227`), header only;
- batch `checkDuplicates` (§5).

It runs **before** any chromosome normalisation (09). It reads raw header names, and the confirmed build is what normalisation then uses.

---

## 4. UX: one compact control, every flow

### 4.1 The control: `GenomeBuildField.vue` (new, ~60 lines, `components/import/`)

```
Genome build   (•) GRCh38 (hg38)   ( ) GRCh37 (hg19)        ← v-radio-group inline, density compact
               Contig lengths match GRCh38 (25 of 25).       ← hint = BUILD_COPY for the state + top evidence
```

- Options are `GENOME_BUILDS.filter(b => b.importable)`, never a hard-coded list. An `excluded` build stays selectable but gets the suffix " — header disagrees" (custom references exist).
- **Pre-selected only when `definitive`.** For every other state nothing is pre-selected, and the suggested option (if any) carries the suffix " · suggested". **The user's one click on a radio is the explicit confirmation.** There is no separate checkbox. A required rule blocks Import with an inline error; the button stays enabled and focus moves to the group on failure (disabled buttons are not focusable).
- "Why": the first evidence `detail` inline. The full `evidence[]` / `excluded[]` list sits behind a `v-tooltip` on an ⓘ icon (`aria-label="Build evidence"`); the same text is in `aria-describedby`.
- If the user switches away from a `definitive` suggestion, the hint turns to warning colour: "The contig lengths are GRCh38. Variants imported as GRCh37 get the wrong chromosome names and links." It does not block (custom references exist).
- Keyboard: native radio semantics (Tab into the group, arrow keys to change). Hint messages are linked by Vuetify. There is no colour-only state: every warning has text.
- **"Auto-detected" is never shown.** The copy names the evidence or says it found none.

### 4.2 Copy (`BUILD_COPY`)

| State | Hint |
|---|---|
| definitive | "Contig lengths match {build} ({n} of {m})." |
| strong | "Found in the {source} header ({detail}). No contig lengths to confirm it. Select the build to continue." |
| conflict, suggested | "Contig lengths say {build}, but the {source} header says {other}. Check before importing." |
| conflict, none | "The header points to more than one build ({list}). Choose the build these coordinates use." |
| none | "No genome build found in this file. Choose the build these coordinates use." |
| not importable | "This file is {label}. VarLens cannot import {label} yet." Import is disabled. |
| multi-file mismatch | "{fileA} is {b1}, {fileB} is {b2}. One case holds one build: remove one file or import them as separate cases." Import is disabled. |
| batch tally | "{n} GRCh38 · {k} GRCh37 · {u} without a build" + the fallback control below |

### 4.3 Per flow

| Flow | Change |
|---|---|
| **Single VCF** (`VcfPreviewStep.vue:31-40`) | Replace the `v-select` with `GenomeBuildField` and `preview.buildDetection`. `selectedGenomeBuild` starts `null`, and `ImportWizard.vue:246,734` go to `null`. The Start button (`ImportWizard.vue:144-149`) validates. This closes I-P2-3. |
| **Multi-file, one case** (`VcfImportDialog.vue`, under "Case name" at `:111`) | Add one `GenomeBuildField` fed by `combineBuildDetections(files.map(f => f.buildDetection))`. Always send the chosen build (`:626-631` sends `{ genomeBuild: chosen }`). A per-file chip in `VcfFileList.vue:64-72` shows each file's suggestion, in warning colour when it disagrees. A disagreement blocks (the mixed-build-per-case rule). |
| **Batch / JSON / zip / folder** (`BatchReviewPhase.vue`) | Show the tally line, with `strong` files counted separately ("{s} from header tags only"). Each VCF with `definitive`/`strong` keeps **its own** build. Decision: in batch, a `strong` file is not confirmed file by file. The tally is the confirmation, because 200 clicks would train users to click blindly. The single-file import stays available for a file the user doubts: a batch makes many cases, and mixed builds across cases are legal because cohort keys include the build. One `GenomeBuildField` labelled **"Build for files without one"** is required only when `u > 0`, which is always true for JSON. `conflict` files are listed and skipped with their reason. There is no per-file override in batch; use the single-file import for that. |
| **Web upload** | Same components, same IPC. Nothing web-specific beyond the params (§5). |
| **JSON without a header** | It goes through batch, so the fallback control is required. Copy: "JSON files carry no genome build. Choose the build their coordinates use." |

---

## 5. Lean implementation plan

**One PR, "PR 0" of the 09 series.** It lands before 09 PR 1, which then reads `primaryPrefix` / `mito.canonical` from the same config instead of its own `'GRCh37' | 'GRCh38'` literals.

| # | Change | Size |
|---|---|---|
| 1 | `src/shared/config/genome-builds.config.ts` (data: three builds, tag sources, liftover markers, copy) + export in `config/index.ts`. `type GenomeBuildId = (typeof GENOME_BUILDS)[number]['id']`. | +120 (mostly the length table) |
| 2 | `src/shared/genome/genome-build.ts`: `detectGenomeBuild` + `combineBuildDetections`. **Delete** `src/main/services/GenomeBuildDetector.ts` and move its 16 test cases over. | +90 / −55 |
| 3 | `vcf-header-parser.ts:227`: `genomeBuild = d.confidence is definitive or strong ? d.suggested : null`, plus `buildDetection: d`. `vcf-preview.ts`: `maxPos` in the line loop; pass it in; return `buildDetection` (add it to `VcfPreviewResult`, `shared/types/vcf.ts:24`). Keep `detectedGenomeBuild`, but only as `suggested` when the confidence is definitive/strong (the same rule as `header.genomeBuild`), so a `conflict` suggestion is never shown as "detected" by `ImportSummaryView.vue:234`, `VcfFileList.vue:64` and the mocks. | +25 |
| 4 | Trust boundary: `import-schemas.ts:29` `genomeBuild` becomes `z.enum(importable ids)`, with the same check in the web `normalizeImportVcfOptions`. The multi-file lock (`import-logic.ts:351-358`) uses only the wizard's value, with no read-back of the worker default. `assertGenomeBuildMatches` compares against `detection.suggested` only when it is definitive/strong. | +10 / −8 |
| 5 | Batch: `DuplicateCheckItem` gains `build?: { suggested; confidence }` (header-only `parseVcfHeader` for VCF paths in `batch-utils.checkDuplicates`, and in the web `checkSessionDuplicates`). `checkDuplicates` is re-run on every "Remove from names" edit (`useZipImportCleanup.ts:175-193`, 300 ms debounce), so it gets an optional `detectBuilds` flag. Only the first call (`checkDuplicatesAndAdvance`, `:158-162`) sets it, and the recheck keeps the builds from that first result by `filePath`. Otherwise every keystroke would re-read every header. `batchImport.start` gains an optional `fallbackGenomeBuild`, threaded through the preload, the handler, the web `batch-import-run.ts` and its route. The workers (`import-worker.ts:196`, `postgres-import-worker.ts:267,492,543`) use `detection.suggested ?? fallbackGenomeBuild` and fail the file when the detection is `conflict`. `?? 'GRCh38'` stays only as a never-reached guard. | +45 |
| 6 | `GenomeBuildField.vue` + use it in `VcfPreviewStep`, `VcfImportDialog`, `BatchReviewPhase`; chip tone in `VcfFileList`. | +100 / −15 |

**Total ≈ +400 / −80**, of which about 100 lines are the data table. The IPC change is additive (optional param + optional result field), so the preload contract test needs only the new param (`tests/shared/types/preload-contract.test.ts`). Parity entries are unchanged (`checkDuplicates` stays sharedRead, `start` stays adapter).

**Tests (all table-driven from the config).**
- `tests/shared/genome/genome-build.test.ts`, generated for each build in `GENOME_BUILDS`:
  - a full contig header → definitive;
  - each single primary contig → definitive;
  - `chr`-prefixed vs bare → same result;
  - each alias in each `BUILD_TAG_SOURCES` prefix → strong;
  - a tag that contradicts the lengths → conflict with suggested = lengths;
  - a position beyond each contig length → excluded;
  - a liftover line → its aliases ignored.
- Plus fixed cases: mito-only 16,569 → none; hg19 `chrM` 16,571 → GRCh37 definitive; a custom chr1 length → none with an evidence line; an empty header → none; the real fixture headers (`tests/test-data/vcf/*.vcf.gz`) → GRCh38 definitive.
- `combineBuildDetections`: agree, disagree, none+strong, and an exclusion that hits the suggestion.
- Component: `GenomeBuildField` renders the copy for every state; only `definitive` pre-selects; `none`/`strong`/`conflict` block Import until a radio is clicked. `vcf-import-dialog.test.ts`: a multi-file mismatch disables Import.
- Worker/handler: the batch fallback is applied to a JSON file; a declared GRCh37 VCF in a batch lands as GRCh37; the multi-file lock no longer rejects a file because of the default.
- **Adding a build is config-only**, and a test proves it: inject a fake fourth build into the detector (it takes the config as a default parameter) and assert it is detected without code changes.

Verification bar (CLAUDE.md): `make typecheck`, `make rebuild-node && make test`. The UI change must be checked in the dev app on the single, multi-file and batch flows, and with `VARLENS_WEB=1` for web.

---

## 6. Risks and limits

1. **Liftover files.**
   - Picard `LiftoverVcf` writes the target sequence dictionary, so the lengths are right.
   - CrossMap/`liftOver` outputs can keep the source `##contig` lines and `##reference`. The lengths then point to the *source* build, and the positions exclude it only when one passes a source length.
   - Mitigation: skip the `LIFTOVER_MARKERS` lines (§3.3). When a marker is present, cap the confidence at `conflict`, so the user always confirms.
   - The marker list is a guess until tested on real CrossMap/Picard outputs. Add fixtures before shipping.
2. **Custom references** (decoys, `hs38DH` alts, masked or bacterial-spiked references).
   - The primary lengths are unchanged in the common ones, so they still detect.
   - A truly custom chr1 → `none` and the user chooses. The ` — header disagrees` option keeps them unblocked.
3. **T2T-CHM13.** It is recognised (config `importable: false`) and blocked with copy, not imported as GRCh38. Making it importable needs gene-reference, panel and link data for that build. That is more than config, and the copy says "not yet".
4. **Headerless or minimal VCFs** (no `##contig`, no tags). The result is `none`, and the user chooses. Position exclusion catches only gross errors (for example chr21 > 46.7 Mb rules out GRCh38). It cannot tell GRCh37 from GRCh38 for most positions.
5. **JSON.** It carries no evidence, so the user's choice is the only source. Position exclusion from JSON rows is possible but would need a second parse; skipped.
6. **Existing cases.** Batch and JSON cases imported before this fix are all `GRCh38`, whatever their real build. This PR cannot fix them, because the build was never recorded.
   - DO-LATER: a one-off re-check that re-runs `detectGenomeBuild` on `case_import_files.file_path` where the file still exists and lists the disagreements. Add a release-note line.
   - There is no post-import "change build" action. Adding one requires 09's re-normalisation, so it is out of scope.
7. **Annotator vs coordinates.** VEP run with the wrong `--assembly` produces a `strong` tag for the wrong build. Lengths outrank it when present. Without lengths, the required click is the guard (in batch, only the tally; see §4.3).
8. **md5 / refget skipped.** The primaries already discriminate on length. The md5 matters only for same-length variants (for example the hg19 vs GRCh37 primaries, which are identical sequences). Add it to the config later if a real file needs it.
9. **Alias false positives.** A token such as `b37` inside an unrelated path. The prefix-scoped lines and the "not followed by a digit" boundary limit this, and lengths override it.

## Sources

- VCF v4.3/4.5 spec, `##contig`, `##reference`, `##assembly` (§1.4.7): https://samtools.github.io/hts-specs/VCFv4.3.pdf
- UCSC chrom.sizes: hg19 https://hgdownload.soe.ucsc.edu/goldenPath/hg19/bigZips/hg19.chrom.sizes · hg38 https://hgdownload.soe.ucsc.edu/goldenPath/hg38/bigZips/hg38.chrom.sizes · T2T hs1 https://hgdownload.soe.ucsc.edu/goldenPath/hs1/bigZips/hs1.chrom.sizes
- hg19 `chrM` = NC_001807 (16,571 bp): https://hgdownload.soe.ucsc.edu/goldenPath/hg19/bigZips/README.txt
- Choosing hg19/hg38 from `##reference` and `##contig` lengths (user guide): https://cgar-doc.readthedocs.io/en/latest/upload_sample.html
- A contig length mismatch as the classic build-mismatch symptom (GATK): https://biostars.org/p/426960
- VarSome asks for the reference genome before annotating: https://varsome.com/variant/hg19
- Liftover tool accuracy (CrossMap / Remap / liftOver): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10606611/
- Hail `import_vcf` requires an explicit `reference_genome` (a declare-not-guess precedent): https://hail.is/docs/0.2/methods/impex.html
- VNtyper (local): `vntyper/scripts/assembly_guard.py`, `pipeline_guards.py`; `vntyper-online-frontend/resources/js/bamProcessing.js`, `assemblyConfigs.js`, `uiUtils.js`.

---

## Ponytail review of this design (self-review, applied)

What this change does: one config file and one pure function replace the header-only detector. Every import flow gets the same compact build control, and the silent `'GRCh38'` default stops reaching the case rows.

**Should fix (applied above):**
1. **A checkbox on top of a radio group for `strong`** (§4.1). Two controls did one job. *Fix:* pre-select only on `definitive`; for every other state the radio click itself is the confirmation. This removes one state from the component and its test.
2. **`checkDuplicates` re-reads every header on each keystroke** (§5 row 5). It re-runs on every "Remove from names" edit (`useZipImportCleanup.ts:175-193`). *Fix:* a `detectBuilds` flag on the first call only; the recheck keeps the builds by `filePath`.
3. **`detectedGenomeBuild` could show a `conflict` suggestion as "detected"** (§5 row 3). *Fix:* the same rule as `header.genomeBuild`: set it only when the confidence is definitive or strong.
4. **The evidence rank as a config value** (§3.1). It is a knob that cannot change behaviour without code changes, so it was config nobody can really set. *Fix:* it is a doc comment. Everything that varies (aliases, lengths, tag prefixes, liftover markers, copy) stays config data, as the product-owner rule asks.
5. **Batch `strong` files were silently not confirmed** (§4.3). *Fix:* it is now a stated decision: they are counted separately in the tally, and the tally is the confirmation.

**Nice to have (not applied):**
6. The `config` default parameter on `detectGenomeBuild` exists only for the "a fourth build is config-only" test. Keep it: it is one default parameter, and it is the proof the product owner asked for.

Verdict: Ship the design (the findings are applied).
Lean: ≈ −20 lines versus the first draft (the checkbox state and the rank constant).
Not checked: real CrossMap / Picard `LiftoverVcf` / DRAGEN / DeepVariant headers. The `LIFTOVER_MARKERS` and `BUILD_TAG_SOURCES` prefixes are a seed list and need fixture files before shipping.
