# High-Performance Synthetic Variant Simulator Specification

**Date:** 2026-10-06  
**Status:** Approved for Implementation  
**Location:** `.planning/specs/2026-10-06-synthetic-variant-simulator-design.md`

## 1. Overview & Objectives

VarLens requires a high-performance offline simulator capable of generating realistic genetic variant datasets for:
1. Benchmarking and profiling import, query, and analysis pipelines at scale (up to 10,000 sample files).
2. Development and testing without requiring access to sensitive patient genomic data.
3. Realistic evaluation of filtering, cohort analysis, ACMG prioritization, and HPO phenotype matching.

The simulator must:
- Generate files in the target sample schema:
  - **Simple JSON (`.json`, `.json.gz`)**: 22-field variant object array with top-level sample metadata.
  - **Columnar JSON (`.json`, `.json.gz`)**: VarVis-compatible format with dynamic data dictionaries (`Gene`, `Transcript`, `HpoSimScore`, `MoI`).
  - **Standard VCF 4.2 (`.vcf`, `.vcf.gz`)**: With standard CSQ/ANN VEP-style annotations.
  - **Excel (`.xlsx`)**: With `Variants` and `Export Info` sheets matching VarLens export format.
  - **Cohort Index (`samples.txt`, `manifest.json`)**: Sample inventory and run metadata.
- Be resource-efficient and streaming-based, avoiding large in-memory object graphs.
- Support configurable variant counts per sample (panel scale ~3,500 variants, exome scale ~30,000 variants, custom ranges).
- Use reproducible pseudo-random generation with deterministic seed derivation per sample.
- Generate biologically plausible variants grounded in real human gene models from `resources/gene_reference.db`.

---

## 2. Target Data Schemas

### 2.1 Simple JSON Schema (`.json`, `.json.gz`)

Top-level object:
```json
{
  "person_id": 1001,
  "lims_id": "SIM-00001",
  "analysis_id": 5001,
  "variant_count": 3750,
  "variants": [
    {
      "lims_id": "SIM-00001",
      "person_id": 1001,
      "analysis_id": 5001,
      "chr": "1",
      "pos": 156134650,
      "ref": "C",
      "alt": "T",
      "gene_symbol": "COL1A1",
      "omim_mim_number": "120150",
      "consequence": "MODERATE",
      "gnomad_af": 0.00012,
      "cadd": 24.3,
      "clinvar": "Likely_pathogenic",
      "gt_num": "0/1",
      "func": "missense_variant",
      "qual": 1250,
      "hpo_sim_score": 0.85,
      "transcript": "NM_000088.4",
      "cdna": "c.1580G>A",
      "aa_change": "p.Arg527His",
      "hpo_match": [
        {
          "accessionId": 1001,
          "name": "Osteogenesis imperfecta",
          "abbreviation": "HP:0000001"
        }
      ],
      "moi": [
        {
          "accessionId": 1,
          "name": "Autosomal dominant inheritance",
          "abbreviation": "AD"
        }
      ]
    }
  ]
}
```

### 2.2 Columnar JSON Schema (`.json`, `.json.gz`)

Matches `ColumnarStrategy.ts`:
- Wrapped: `{ "<lims_id>": { "header": [...], "data": [[...]] } }`
- Unwrapped: `{ "header": [...], "data": [[...]] }`
- Dictionaries: `Gene`, `Transcript`, `HpoSimScore`, `MoI` mapped by dictionary keys.

### 2.3 Excel Schema (`.xlsx`)

- Sheet `Variants`: Columns: `LIMS ID`, `Chromosome`, `Position`, `Reference`, `Alternate`, `Genotype`, `Gene`, `Function`, `Impact`, `Transcript`, `cDNA Change`, `AA Change`, `gnomAD AF`, `CADD Score`, `Quality`, `ClinVar`, `HPO Score`, `HPO Match`, `Mode of Inheritance`.
- Sheet `Export Info`: Key-value metadata table (`Export Information`, `Export Date`, `Total Samples`, `Total Variants`, `Samples Included`).

### 2.4 VCF 4.2 Schema (`.vcf`, `.vcf.gz`)

Standard VCF 4.2 with header lines and `CSQ` format:
`CSQ=Allele|Consequence|IMPACT|SYMBOL|Gene|Feature|BIOTYPE|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|Existing_variation|gnomADe_AF|CADD_PHRED|ClinVar_CLNSIG`
Genotype columns: `GT:GQ:DP:AD` with values like `0/1:99:45:25,20`.

---

## 3. Architecture & Components

```
scripts/simulator/
  ├── cli.ts                   # CLI entrypoint (parse args, orchestrate workers)
  ├── engine.ts                # Cohort & sample orchestration, parallel batching
  ├── worker.ts                # Worker thread for independent sample generation
  ├── catalog.ts               # Gene reference reader & biological pool loader
  ├── random.ts                # Deterministic PRNG (Mulberry32) and distributions
  ├── models.ts                # Biological consequence & mutation models
  ├── types.ts                 # Shared interfaces for simulator
  └── writers/
      ├── simple-json-writer.ts   # Streaming Simple JSON (+ gzip)
      ├── columnar-json-writer.ts # Streaming Columnar JSON (+ gzip)
      ├── vcf-writer.ts           # Streaming VCF (+ gzip)
      ├── xlsx-writer.ts          # Fast XLSX workbook generator
      └── manifest-writer.ts      # samples.txt and manifest.json
```

### 3.1 Deterministic PRNG & Seed Derivation

Each sample $i$ receives a deterministic seed:
$$\text{sampleSeed} = \text{hash}(\text{rootSeed}, \text{sampleIndex}, \text{"sample"})$$
All variant picks for that sample derive from this seed, guaranteeing identical outputs regardless of worker count or thread scheduling.

### 3.2 Biological Realism Engine

1. **Gene Catalog**: Loaded from `resources/gene_reference.db` (GRCh38 coordinates, HGNC symbols, OMIM IDs).
2. **Coordinate & Mutation**: Randomly placed within genuine gene boundaries $[start\_pos, end\_pos]$ with valid transitions/transversions and indels.
3. **Consequence & SO**: Consequence distribution modeled on typical clinical panels/exomes:
   - `MODERATE` (missense): ~50%
   - `LOW` (synonymous): ~25%
   - `MODIFIER` (intron/UTR): ~20%
   - `HIGH` (stop_gained, frameshift, splice): ~5%
4. **HGVS & Protein**: Valid cDNA position and codon offset matching the consequence.
5. **gnomAD Frequency**: Realistic Zipf/Beta rare-variant distribution with a subset of novel variants (`null`).
6. **CADD & ClinVar**: Skewed correlations based on IMPACT level.
7. **HPO & MOI**: Valid HPO terms and inheritance modes (AD, AR, XD, XR).

### 3.3 Streaming & Performance Guarantees

- Chunked buffer streaming directly into `zlib.createGzip({ level: 6 })` or file streams.
- Avoids keeping entire variant arrays in memory.
- Worker thread pool splits sample batches evenly.
- Peak RSS bounded under 200MB per worker.

---

## 4. Verification & Quality Gates

1. **Unit tests**: PRNG repeatability, model distributions, writer format integrity.
2. **End-to-End import test**: Ingest generated files through VarLens `ImportService` (`simple`, `columnar`, `vcf`) to verify 100% roundtrip compatibility.
3. **Throughput benchmark**: Test generation rate on 10, 100, and 1,000 samples.
4. **Code Quality**: File line counts strictly bounded (<600 lines), full TypeScript strict typing, passing `make ci`.
