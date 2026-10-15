# Shortlist

The **Shortlist** tab is a ranked, cross-type view of the most interesting variants in a case. It combines SNV/indel, SV, CNV, and STR candidates into a single list ordered by a weighted clinical-relevance score, so you can triage the best candidates without jumping between per-type tabs.

![Shortlist tab in a case view, with three key regions highlighted](/screenshots/shortlist-overview.png)

1. **Shortlist tab** — a warm-primary accent bar marks it as categorically different from the raw per-type tabs that follow (SNV/Indel, SV, CNV, STR). Shown for every case that contains at least one variant type.
2. **Panel header** — **preset picker** on the left, **status line** in the middle (`Scored (capped): N → top M (elapsed ms)`), and a **Refresh** button on the right.
3. **Ranked row** — rank number, weighted **Score** (hover for a per-component breakdown), variant type chip, gene, coordinate + HGVS c./p. (SNV/indel), impact, allele frequency, ClinVar, star toggle, and a row-level actions menu.

## What it is for

The Shortlist exists for two complementary reasons:

1. **Cross-type comparison in a single view.** A loss-of-function SNV, a large deletion, and a pathologic STR expansion can now compete for attention under one ordering, which matches how clinicians actually triage multi-assay cases.
2. **Algorithmic ranking of best variants.** Even when a case has only one variant type (e.g. SNV-only research exomes), the ranked view saves you from manually configuring filters and sorts to surface top candidates.

## Built-in presets

Four presets ship with every database and drive different triage strategies. Switch between them from the **preset picker** in the panel header.

| Preset | Scope | Strategy |
|---|---|---|
| **Tier 1 candidates** | All 5 variant types | Strict: rare HIGH/MODERATE impact, top 50. ClinVar P/LP and starred variants are pinned to the top regardless of their raw score. |
| **All rare damaging** | All 5 variant types | Broad: any rare HIGH/MODERATE variant, top 200. Score-driven ordering with no pins. |
| **Recessive candidates** | SNV/indel only | Narrower: rare HIGH/MOD SNVs with impact + pathogenicity + rarity + ClinVar weighting. Good starting point for recessive disease cases. |
| **Evidence ranking (beta)** | SNV/indel only | Evidence points per rule and inheritance mode (see [Evidence ranking](#evidence-ranking-beta)). Candidates: gnomAD AF ≤ 1 % (or not in gnomAD), impact HIGH/MODERATE/LOW, top 100. |

Each preset defines:
- A **filter set** applied to all variant types before ranking.
- A **per-type override** that loosens filters where needed (e.g. SV/CNV get a 1% allele-frequency ceiling instead of the 0.1% used for SNVs because no gnomAD-SV source is wired).
- A **weight vector** for the five score components (impact, pathogenicity, rarity, ClinVar, phenotype).
- Optional **pin rules** (`clinvarPinTop`, `pinStarredTop`) and **tie-breakers** applied after the primary rank sort.

The full heuristic, every numeric threshold, and every rationale is documented in the [Shortlist scoring heuristic reference](https://github.com/berntpopp/VarLens/blob/main/.planning/docs/shortlist-scoring-heuristic.md) (developer doc — useful if you want to understand exactly how a score is computed).

## How rows are ordered

After Stage 1 fetches candidate rows from the database and Stage 2 computes a weighted score per row, the final sort applies a **5-level partition**:

1. **Starred-pinned** first — when `pinStarredTop` is on and you've starred the row.
2. **ClinVar-pinned** next — when `clinvarPinTop` is on and the row's ClinVar significance is ≥ Likely pathogenic.
3. **`rank_score` DESC** — the primary weighted sort.
4. **Caller-supplied tie-breakers** — up to 10 sort directives (e.g. CADD DESC, then gene name ASC).
5. **`id` ASC** — stable deterministic fallback.

Starred variants override ClinVar-pinned ones, so a star is the strongest curation signal you can apply.

## Evidence ranking (beta)

The **Evidence ranking (beta)** preset scores each SNV/indel with **evidence points** instead of a weighted average:

- **Evidence groups.** Each group (population frequency, variant effect, CADD, ClinVar, phenotype match, disease gene) is a list of rules written in the [filter language](./filtering.md). The **first** rule that matches adds its points; a pinned *reference* rule catches everything else. A field a variant does not have never adds points — missing data is a rule of its own (e.g. *not in gnomAD*).
- **Inheritance modes.** The modes are checked in a fixed order — recessive homozygous, recessive *possible* compound heterozygous (two or more heterozygous candidate alleles in the gene; phase is unknown unless **Consider phased variants** is on and the calls share a VCF `PS` phase set, in which case the score tooltip says *confirmed, in trans* or *in cis*; a cis pair keeps its points and only gets the label), X-linked, dominant heterozygous — and the first that fits adds its points. If none fits, *No compatible inheritance* applies. Inheritance comes from the gene's mode of inheritance and the variant's zygosity; chrX calls in male cases (case sex) count as hemizygous outside the pseudoautosomal regions.
- **Points are ranking points, not probabilities.** A higher score means more supporting evidence under these rules; it is not a likelihood of pathogenicity.

Hover the **Score** to see the inheritance mode, every rule that contributed and its points — they add up to the score. Rows of a possible compound heterozygous pair say so and name how many partner variants there are.

### How it was validated

The ranking was tested by simulation: real ClinVar pathogenic/likely pathogenic variants (two-star review or better) were placed into three real exomes (varvis exports, kept on the local machine), with genotypes matching the disease's inheritance and benign ClinVar variants as decoys. With ClinVar hidden, the causal variant was among the first 10 rows in **36 %** of simulated cases (current *Tier 1 candidates*: 14 %); with ClinVar visible, in **97 %** (*Tier 1*: 87 %). Rare benign decoys almost never reached the first 10 rows. The full report, including every scenario and limitation, is in the repository under `.planning/artifacts/shortlist-sim/2026-10-12-full-v2/report.md`.

**Limits.** Three immunology exomes from one laboratory; all three backgrounds are female, so X-linked recessive variants in males were not tested; when a case lacks inheritance and gene annotations the ranking can fall behind *Tier 1*. Treat it as a beta and review the evidence in the tooltip.

## Editing rankings

Open **Settings → Shortlist ranking**, or click **Edit ranking** next to the preset picker. Built-in rankings are locked — **Duplicate** one (or create **New** from the template) to edit:

- **Candidates** — the allele-frequency limit, impact levels and how many rows to show.
- **Inheritance modes** — the condition and points of each mode (the order is fixed).
- **Evidence groups** — add, remove and reorder rules (keyboard: the arrow buttons), edit each rule's label, condition and points. Conditions get autocomplete and are checked as you type; errors show at the field and in the footer, and **Save** stays disabled until every rule is valid.
- **Preview** — when a case is open, compare the first rows under your draft with the saved ranking.

Rankings can be exported and imported as JSON to share them between installations. Choose the ranking the Shortlist tab opens with under **Default for the shortlist**. Rules can use any imported annotation field as `info.<KEY>` (see [Importing Data → Annotation fields](../guide/importing-data.md#annotation-fields)).

## Score breakdown on hover

Hover any row's **Score** badge to see the weighted breakdown: the five components (impact, pathogenicity, rarity, ClinVar, phenotype) with their raw sub-scores in [0, 1], alongside any active pin flag (Starred or ClinVar P/LP). This makes the ranking transparent — you can always see *why* a row is near the top.

## CNV and STR phenotype scoring

For copy-number variants (CNVs) and short tandem repeats (STRs), the phenotype match comes from the **locus** the call hits:

- **CNVs, gene route.** The CNV is scored by the best HPO similarity score among the indexed disease genes it overlaps (`max S(g)`).
- **CNVs, region route.** A CNV that covers a ClinGen dosage-sensitive region (for example 16p11.2 BP4–BP5) is scored against that region's syndrome, scaled by how much of the region it covers and its ClinGen dosage sensitivity (HI for deletions, TS for duplications). The higher of the gene route and region route is used.
- **STRs.** The call is matched to its STRchive locus. Its repeat size gives a band (normal, intermediate, premutation or full), and the score covers only the diseases of that band. A normal band, a recessive locus with only one expanded allele, or a refuted locus gives no score.

Hover the **Score** to see a `locus:` line under the phenotype block. For a region it shows the region, the dosage score and its source, the coverage, and how many of the overlapped genes are HPO genes (genes with HPO disease annotations). For a gene it shows the driving gene and how many HPO/coding genes the CNV overlaps. For an STR it shows the gene, motif, repeat copies, band, inheritance and typical onset. The rank line still compares the score with all HPO genes. It is a ranking aid, not a likelihood of pathogenicity.

The results are available as [filter language](./filtering.md) fields in custom rankings: `hpo_best_locus` (gene, region or STR id), `cnv_gene_count` (protein-coding genes the CNV overlaps) and `str_band` (with `variantTypeScope` including `cnv` and/or `str`).

### Data sources

**Update HPO data** downloads all reference sources and keeps them versioned on your machine. The HPO data row lists the installed version of each source:

- **Human Phenotype Ontology** (HPO licence): terms and disease annotations.
- **ClinGen Dosage Sensitivity** (CC0 1.0): gene and region haploinsufficiency and triplosensitivity scores.
- **STRchive** (MIT): repeat loci, thresholds and diseases.
- **Mondo** (CC BY 4.0): maps ClinGen region diseases to OMIM and Orphanet ids.

If an optional source (ClinGen, STRchive or Mondo) fails to download, the update keeps that source's previous version and warns. If the HPO download fails, the whole update fails and the installed data is left untouched.

## Auto-refresh on annotation

When you star, comment on, or ACMG-classify any variant in the current case (from any tab — SNV, SV, CNV, STR, or Shortlist itself), the Shortlist automatically re-fetches within one IPC round-trip. You never need to click **Refresh** manually. This is driven by an internal `variants:annotationChanged` broadcast the main process emits on every successful annotation write.

## Row actions

Each row supports:

- **Click the row** → opens **Variant Details** in the side panel, same as the per-type tables. Structural-variant, CNV, and STR rows all route through the same drill-down path thanks to a shared row contract.
- **Star icon** → toggles the star. Writes through `annotations:upsertPerCase`; the broadcast refresh handles the rest.
- **⋮ (kebab)** menu → **View details** (same as row click) and **View in \<type\> tab** — the latter switches to the corresponding per-type tab where you keep the full per-type VariantTable context.

## Pagination and scrolling

The Shortlist table paginates at **50 rows per page** by default. You can switch to 25, 50, 100, 250, or 500 via the per-page selector at the bottom. For large result sets the **table body scrolls independently** of the footer so pagination controls are always in view.

## Choosing your default active tab

Which tab opens first when you navigate into a case is a **per-user preference**. The default is **Shortlist**, but if you prefer to start from the raw per-type table you can flip it:

![Application Preferences dialog with the Case View section highlighted](/screenshots/shortlist-settings.png)

1. **Default active tab** dropdown under **Case View** in the preferences dialog. Choose:
   - `Shortlist (ranked view)` — default; land on the ranked view every time.
   - `SNV/Indel (per-type table)` — land on the first present per-type tab (SNV/indel, or whichever type the case has).

### Where to find the setting

1. Click the **gear icon** ⚙ in the top-right corner of the VarLens app bar.
2. Select **Application Preferences**.
3. Scroll to the **Case View** section.
4. Change **Default active tab** to your preference.
5. The change is saved automatically and takes effect the next time you open any case.

The Shortlist tab itself is always shown when a case has at least one variant type — this preference only controls which tab is **default-active**, not whether the tab exists. Switching to Shortlist from a per-type tab is still a single click away.

## When the Shortlist tab does NOT appear

Only one case in the whole UI where the tab is hidden: an **empty case** with zero variants of any type. Every case with at least one SNV, indel, SV, CNV, or STR gets a Shortlist tab.

## Known limitations

These are documented as Phase-1 gaps and tracked for future releases:

- **No population frequency for SVs, CNVs, or STRs.** There's no gnomAD-SV equivalent wired into VarLens yet, so the rarity component for those types is a placeholder `1.0` (full credit). SNV rarity via gnomAD works as expected.
- **Phenotype similarity in the weighted presets.** The three weighted presets set the `phenotype` weight to 0. The *Evidence ranking (beta)* uses the imported gene-level HPO similarity score (e.g. varvis *HPO Score*).

## Related

- [Variant Table](./variant-table.md) — the raw per-type tables underneath each tab.
- [Filtering](./filtering.md) — the shared filter engine that drives the Shortlist's Stage-1 query.
- [Filter Presets](./filter-presets.md) — the non-Shortlist preset system (classic `kind='filter'` presets).
- [Variant Details](./variant-details.md) — the side panel opened by row clicks.
- [Annotations](./annotations.md) — the star / comment / ACMG write-through that drives auto-refresh.
