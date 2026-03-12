# Introduction

VarLens is a desktop application for offline genetic variant analysis. It is designed for research collaborators who need to analyze variant data securely on their own machines, without uploading data to external servers.

## Who is VarLens for?

- **Genetic diagnostics labs** analyzing patient variant data
- **Research collaborators** receiving variant datasets for review
- **Bioinformaticians** who need a quick visual interface for variant files

## Key Capabilities

- **Import** variant data from JSON files (single or batch)
- **Browse** variants in a sortable, filterable data table
- **Filter** by gene, consequence, allele frequency, pathogenicity scores, and more
- **Annotate** variants with stars, comments, tags, and ACMG classifications
- **Enrich** variants on-demand with VEP, SpliceAI, and MyVariant.info
- **Analyze cohorts** with carrier aggregation and gene burden testing (Fisher's exact test)
- **Export** filtered results to Excel (XLSX)

## Architecture

VarLens is an Electron desktop app built with:

- **Vue 3 + Vuetify 3** for the user interface
- **SQLite** (via better-sqlite3) for local data storage
- **Electron** for cross-platform desktop distribution (Windows, macOS, Linux)

All processing happens locally. External API calls (VEP, gnomAD, ClinVar) are optional and only triggered when you explicitly request enrichment.

## Next Steps

- [Explore the app layout](./app-layout.md) to learn the interface
- [Install VarLens](./installation.md) on your platform
- [Import your first dataset](./importing-data.md)
