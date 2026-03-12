# Supported Formats

VarLens supports several JSON-based data formats for variant import.

## JSON Columnar Format

The most common format. Data is organized with a header array describing columns and a data array of row values. Files must be gzip-compressed (`.json.gz`).

```json
{
  "CaseName": {
    "header": [
      { "id": "Chr", "type": "text", "label": "Chromosome" },
      { "id": "Pos", "type": "number", "label": "Position" },
      { "id": "Ref", "type": "text", "label": "Reference" },
      { "id": "Alt", "type": "text", "label": "Alternate" },
      { "id": "Gene", "type": "dictionary", "label": "Gene",
        "dataDictionary": { "1": "BRCA1", "2": "TP53" } },
      { "id": "Consequence", "type": "dictionary", "label": "Consequence",
        "dataDictionary": { "1": "HIGH", "2": "MODERATE" } }
    ],
    "data": [
      ["1", 100000, "A", "G", "1", "2"],
      ["17", 200000, "C", "T", "2", "1"]
    ]
  }
}
```

### Header Types

- **text** — Plain text value
- **number** — Numeric value
- **dictionary** — Lookup value referencing a dictionary map in the header

### Recognized Column IDs

| Column ID | Maps to | Notes |
|-----------|---------|-------|
| `Chr` | Chromosome | |
| `Pos` | Position | |
| `Ref` | Reference allele | |
| `Alt` | Alternate allele | |
| `Gene` | Gene symbol | Dictionary type |
| `Consequence` / `Impact` | Consequence severity | Dictionary: 1=HIGH, 2=MODERATE, 3=LOW, 4=MODIFIER |
| `Func` / `VarType` | Functional class | |
| `selectedTranscript` | Transcript | Dictionary type |
| `cDNA` / `HGVS_C` | cDNA change | |
| `AAChange` / `HGVS_P` | Protein change | |
| `GnomadAF` / `GnomTotal` | gnomAD AF | |
| `CADDPhredScore` | CADD score | |
| `Qual-Index` / `Qual` | Quality score | |
| `ClinVSig` / `ClinVar` | ClinVar significance | |
| `GTNum-Index` / `Genotype` | Genotype | |
| `HpoSimScore` | HPO similarity | Dictionary type |
| `MoI` | Mode of inheritance | Dictionary: AD, AR, XLD, etc. |
| `Omim` | OMIM number | |

## JSON Object Format

Structured format with metadata and sample-level variant objects:

```json
{
  "metadata": { "version": "1.0" },
  "samples": {
    "SampleA": {
      "variants": [
        {
          "chr": "1",
          "pos": 100000,
          "ref": "A",
          "alt": "G",
          "gene_symbol": "GENE1"
        }
      ]
    }
  }
}
```

## JSON Simple Format

A flat array of variant objects:

```json
{
  "variants": [
    {
      "chr": "1",
      "pos": 100000,
      "ref": "A",
      "alt": "G"
    }
  ]
}
```

## Compression

All JSON formats must be gzip-compressed (`.json.gz`). Uncompressed `.json` files are not currently supported.
