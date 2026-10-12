# Importing Data

VarLens supports importing variant data from JSON files in several layouts.

## Supported Formats

VarLens accepts several JSON formats for variant data:

- **Columnar format:** `{ "CaseName": { "header": [...], "data": [[...]] } }` — tabular data with a header row and data arrays (also supported without the case-name wrapper)
- **Object format:** `{ "metadata": {...}, "samples": { "sampleId": { "variants": [...] } } }` — structured variant objects
- **Simple format:** `{ "variants": [...] }` — flat array of variant objects

Files must be gzip-compressed (`.json.gz`); uncompressed `.json` files are not currently supported.

For detailed format specifications, see [Supported Formats](../reference/supported-formats.md).

## Importing a Single Case

1. Click the **+** button in the sidebar and select **Import File**
2. Select your variant file from the file dialog
3. Enter a case name (or accept the auto-generated name from the filename)
4. VarLens imports the data, showing progress in real-time (reading, parsing, inserting phases)

![Import menu showing import options](/screenshots/import-menu.png)

## Annotation fields

VarLens keeps **every annotation field** of an import by default, not only the columns it shows in the tables. Fields VarLens knows (gene, consequence, gnomAD AF, CADD, ClinVar, genotype, …) fill their columns; every other field is stored with the variant and can be used in filters and ranking rules as `info.<KEY>` — for example `info.REVEL:>=:0.7`.

Common evidence fields get one **canonical key** whatever their source, so the same rule works for varvis exports and for VCFs from the annotation pipeline: `REVEL`, `METARNN`, `BAYESDEL`, `ALPHAMISSENSE`, `SPLICEAI_MAX` (the highest of the four SpliceAI scores), `PANGOLIN`, `GNOMAD_POPMAX_AF`, `GNOMAD_HOM`, `LOEUF`, `LOF_OE`, `MISSENSE_Z` and `CLINVAR_REVSTAT`. Field names that are not valid keys are adjusted (`AltAF-Index` → `AltAF_Index`).

**Choosing fields per import.** Step 2 of the import wizard lists the fields found in the file — for JSON with type, fill rate and sample values, for VCF including the CSQ/ANN subfields — and lets you keep, skip or rename each one. **Save as default** stores your choices.

**Defaults.** **Settings → Application preferences → Import → Import fields** sets what happens to fields without a choice (*Keep*, *Keep evidence fields only*, *Skip*) and your saved per-field choices. New imports start from these defaults.

Columnar files whose rows have a different number of values than the header are rejected with the row number, instead of importing shifted values.

## After Import

Once import completes, the case appears in the sidebar. Click it to open the variant table.

![Imported case visible in the sidebar](/screenshots/case-list.png)

## Case Metadata

Click the case name in the header bar to open the case metadata modal. Here you can view and edit case details including status, cohort assignment, HPO terms, comments, and quality metrics.

![Case metadata modal](/screenshots/case-metadata.png)

## Batch Import

For importing multiple files at once, click the **+** button in the sidebar and choose **Import Multiple Files**, **Import Folder**, or **Import ZIP Archive**. Files are processed sequentially with duplicate detection and a summary on completion.

## Genome Build

Every case is stored with the genome build (GRCh38 or GRCh37) its coordinates use. VarLens suggests the build and you confirm it:

- **Contig lengths** in the VCF header (`##contig=<ID=chr1,length=…>`) decide the build. It is pre-selected, and the line under the choice says why.
- **Header tags** (the reference path, VEP cache, SnpEff database) only suggest a build. Click it to confirm.
- If the header names no build or points to more than one, choose the build yourself before importing.
- A case of several VCF files holds one build. Files of different builds must be imported as separate cases.
- In a batch, each VCF keeps the build its header names. JSON files carry no build: choose the **Build for files without one**. A file whose header points to more than one build is not imported; import it on its own.
- T2T-CHM13 files are recognised but cannot be imported yet.

## Tips

- Large files (>100,000 variants) may take a few minutes to import
- Import progress shows the current phase (reading, parsing, inserting) and variant count
- You can cancel an import in progress without losing previously imported data
