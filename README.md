# Varlens

> Your lens into genetic variants

**Varlens** is an Electron-based desktop application for offline analysis of genetic variant data.

## Features

- **Offline-first**: Full functionality without internet connection
- **Familiar UX**: Data-dense interface optimized for clinical genomics workflows
- **High performance**: SQLite + FTS5 for efficient querying of large datasets
- **Cross-platform**: Windows, macOS, and Linux support

## Tech Stack

- **Frontend**: Vue 3, Vuetify 3, TypeScript
- **Desktop**: Electron with electron-vite
- **Database**: SQLite (better-sqlite3) with FTS5 full-text search
- **Testing**: Vitest + Playwright

## Project Status

🚧 **In Development** - See [plan/PLAN.md](plan/PLAN.md) for detailed roadmap.

## Data Format

Varlens imports JSON files containing annotated variant data with support for:
- SNV/Indel annotations
- Population frequencies (gnomAD)
- Pathogenicity predictions (CADD, REVEL, ClinVar)
- Phenotype matching (HPO terms)

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Test Data

Sample variant data for development is in `test-data/`:
- `case-892-snv-annotations.json.gz` - Full SNV export (65k variants)
- `case-892-snv-sample.json.gz` - Sample subset (251 variants)
- `snv-column-schema-minimal.json` - Column definitions (165 fields)

## License

[MIT](LICENSE) - Labor Berlin
