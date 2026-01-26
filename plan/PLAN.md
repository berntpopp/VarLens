# Varlens - Project Plan

> A desktop application for offline analysis of genetic variant data

**Project Name:** Varlens
**Tagline:** *Your lens into genetic variants*

## 📋 Executive Summary

This document outlines the plan to build an **Electron-based desktop application** that enables external collaborators to analyze pre-filtered and annotated genetic variant data offline. The application will import JSON exports from the [varvis-download](https://github.com/LaborBerlin/varvis-download) CLI tool and provide a similar UI/UX to the varvis® web platform, using a local SQLite database for efficient querying and storage.

---

## 🎯 Project Goals

1. **Data Privacy**: Enable secure sharing of variant data without exposing login credentials
2. **Offline-First**: Full functionality without internet connection
3. **Familiar UX**: Mirror varvis® interface patterns for easy adoption
4. **Performance**: Efficient handling of large variant datasets on consumer hardware
5. **Research-Friendly**: Support variant counting, filtering, and cohort analysis

---

## 🔬 Research Summary

### Reference Implementations

| Project | Tech Stack | Relevance |
|---------|-----------|-----------|
| [Cutevariant](https://github.com/labsquare/cutevariant) | Python/PySide2/SQLite | Open-source variant browser with VQL query language |
| [sqlite-search](https://github.com/berntpopp/sqlite-search) | Vue3/Vuetify3/Electron/SQLite FTS5 | Existing stack template with proven architecture |
| [GenomicSQLite](https://github.com/mlin/GenomicSQLite) | SQLite extension | Genomic range indexing, compression |
| [GenMasterTable](https://www.biorxiv.org/content/10.1101/2025.04.10.648172v1.full) | Desktop app | 2025 variant analysis tool supporting VCF/CSV |

### Key Insights

- **Cutevariant** proves SQLite is excellent for variant data (VQL query language, indexed storage)
- **varvis®** features: filtering by inheritance, phenotype (HPO), virtual gene panels, QC visualization
- **SQLite JSON1/JSONB** extension parses JSON at >1 GB/s, supports indexing on JSON properties
- **FTS5** full-text search enables fast gene/variant name searching

---

## 🛠️ Recommended Tech Stack

Based on [sqlite-search](https://github.com/berntpopp/sqlite-search) architecture:

### Frontend
| Technology | Purpose |
|------------|---------|
| **Vue 3** (Composition API) | Reactive UI framework |
| **Vuetify 3** | Material Design components |
| **Pinia** | State management |
| **TypeScript** | Type safety |

### Build & Tooling
| Technology | Purpose |
|------------|---------|
| **Electron** | Cross-platform desktop runtime |
| **electron-vite** | Build configuration |
| **electron-builder** | Multi-platform packaging (Win/Mac/Linux) |
| **Vite** | Fast bundler |
| **Vitest** | Unit testing |
| **Playwright** | E2E testing + MCP for LLM feedback |

### Database
| Technology | Purpose |
|------------|---------|
| **better-sqlite3** | Synchronous, fast SQLite bindings |
| **SQLite JSON1** | JSON parsing and querying |
| **SQLite FTS5** | Full-text search on gene names, annotations |

### Why better-sqlite3 over sqlite3?
- Synchronous API = simpler code
- 2-3x faster than async sqlite3
- Better TypeScript support
- Easier JSON handling

---

## 🖥️ Cross-Platform Development & Building

### Development Environment
- **Primary OS**: Ubuntu (Linux)
- **Target Platforms**: Windows, macOS, Linux

### Local Development on Ubuntu

```bash
# Install dependencies
sudo apt-get install --no-install-recommends -y rpm    # For RPM builds
sudo apt-get install --no-install-recommends -y wine   # For Windows builds (Wine 2.0+)

# Or use Docker (recommended for Windows builds)
docker pull electronuserland/builder:wine
```

### Build Commands

```bash
# Development
npm run dev                    # Start dev server with hot reload

# Build for current platform
npm run build

# Build for specific platforms
npm run build -- --linux       # AppImage, deb, rpm
npm run build -- --win         # NSIS installer, portable
npm run build -- --mac         # DMG (requires macOS for signing)

# Build all platforms (from Ubuntu)
npm run build -- --linux --win # Linux + Windows (macOS needs CI/CD)
```

### electron-builder Configuration

```yaml
# electron-builder.yml
appId: com.laborberlin.varlens
productName: Varlens
copyright: Copyright © 2026 Labor Berlin

directories:
  output: dist
  buildResources: build

files:
  - "dist/**/*"
  - "node_modules/**/*"
  - "package.json"

linux:
  target:
    - AppImage
    - deb
    - rpm
  category: Science
  maintainer: Labor Berlin

win:
  target:
    - nsis
    - portable
  icon: build/icon.ico

mac:
  target:
    - dmg
    - zip
  category: public.app-category.medical
  icon: build/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### GitHub Actions CI/CD Workflow

```yaml
# .github/workflows/build.yml
name: Build and Release

on:
  push:
    branches: [main]
    tags: ['v*.*.*']
  pull_request:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build Electron app
        uses: samuelmeuli/action-electron-builder@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          release: ${{ startsWith(github.ref, 'refs/tags/v') }}
          mac_certs: ${{ secrets.MAC_CERTS }}
          mac_certs_password: ${{ secrets.MAC_CERTS_PASSWORD }}
          windows_certs: ${{ secrets.WINDOWS_CERTS }}
          windows_certs_password: ${{ secrets.WINDOWS_CERTS_PASSWORD }}
```

### Platform-Specific Notes

| Platform | Build From Ubuntu | Code Signing | Notes |
|----------|-------------------|--------------|-------|
| **Linux** | ✅ Native | Optional | AppImage recommended for portability |
| **Windows** | ✅ Via Wine/Docker | Requires cert | NSIS installer works well |
| **macOS** | ❌ Needs macOS | Required for distribution | Use GitHub Actions macOS runner |

---

## 🤖 Playwright MCP Integration (LLM Development Feedback)

### Overview

[Playwright MCP](https://github.com/microsoft/playwright-mcp) enables LLMs (like Claude) to interact with the Varlens UI through structured accessibility snapshots. This allows AI-assisted development, testing, and debugging without screenshots or vision models.

### Why Playwright MCP?

- **LLM-Friendly**: Uses accessibility tree, not pixel-based input
- **Deterministic**: Stable element references via semantic structure
- **Fast**: No vision model overhead
- **Development Feedback**: LLM can navigate UI, test features, report issues

### Architecture with MCP

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────────┐ │
│  │   Claude /   │     │  Playwright MCP  │     │   Varlens Electron   │ │
│  │   LLM IDE    │◄───►│     Server       │◄───►│        App           │ │
│  │  (Claude     │ MCP │  (@playwright/   │ CDP │   (localhost:5173)   │ │
│  │   Code)      │     │   mcp@latest)    │     │                      │ │
│  └──────────────┘     └──────────────────┘     └──────────────────────┘ │
│         │                      │                         │               │
│         │              Accessibility                     │               │
│         │                 Tree                    Electron               │
│         │                                        DevTools                │
│         ▼                      ▼                         ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  LLM can: Navigate UI, Click buttons, Fill forms, Read content,    ││
│  │  Verify layouts, Generate test code, Report accessibility issues   ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Setup for Development

#### 1. Install Playwright MCP Server

```bash
# Global install (recommended for development)
npm install -g @playwright/mcp

# Or run via npx
npx @playwright/mcp@latest
```

#### 2. Configure Claude Desktop / Claude Code

Add to MCP settings (`~/.config/claude/claude_desktop_config.json` or similar):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--browser", "chromium",
        "--viewport", "1280x800"
      ]
    }
  }
}
```

#### 3. Start Varlens in Development Mode

```bash
# Terminal 1: Start Varlens dev server
npm run dev

# The Electron app will open with DevTools
# Renderer runs at http://localhost:5173 (Vite default)
```

#### 4. Connect Playwright MCP to Electron

```bash
# Terminal 2: Start MCP server pointing to Electron's renderer
npx @playwright/mcp@latest \
  --browser chromium \
  --headless false \
  --viewport 1280x800
```

### MCP Configuration Options

| Option | Value | Purpose |
|--------|-------|---------|
| `--browser` | `chromium` | Browser engine (Electron uses Chromium) |
| `--headless` | `false` | Show browser for debugging |
| `--viewport` | `1280x800` | Match typical desktop viewport |
| `--timeout-action` | `5000` | Action timeout (ms) |
| `--timeout-navigation` | `60000` | Navigation timeout (ms) |
| `--save-trace` | `true` | Save Playwright traces for debugging |
| `--output-dir` | `./playwright-output` | Directory for screenshots/traces |

### Development Workflow with LLM

1. **Start Varlens** in dev mode
2. **Connect MCP** to the running app
3. **Ask Claude** to interact with the UI:
   - "Navigate to the Cases view and describe what you see"
   - "Import a test JSON file and verify the variant count"
   - "Click the filter button and check available options"
   - "Test the dark mode toggle"
   - "Generate a Playwright test for the import workflow"

### Example LLM Prompts for Development Feedback

```markdown
# UI Review
"Open Varlens, navigate to the variant table, and describe:
- Column headers present
- Filter controls available
- Any accessibility issues you notice"

# Feature Testing
"Import the sample.json file into Varlens and verify:
- Import completes without errors
- Variant count matches expected (1,234 variants)
- Case appears in the sidebar"

# Test Generation
"Generate Playwright test code for:
- Opening the app
- Importing a JSON file
- Applying a gene filter
- Exporting filtered results"
```

### Alternative: executeautomation MCP Server

For additional features (device emulation, API testing):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    }
  }
}
```

Features:
- 143 device presets (iPhone, iPad, Pixel, etc.)
- Automatic test code generation
- Web scraping capabilities

### Integration with CI/CD

```yaml
# .github/workflows/e2e.yml
name: E2E Tests with Playwright

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

---

## 🏗️ Architecture Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         ELECTRON APP                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │   RENDERER PROCESS  │    │        MAIN PROCESS             │ │
│  │   (Vue 3 + Vuetify) │    │                                 │ │
│  │                     │    │  ┌─────────────────────────┐    │ │
│  │  ┌───────────────┐  │    │  │   Database Service      │    │ │
│  │  │  Components   │  │◄───►  │   (better-sqlite3)      │    │ │
│  │  │  - CaseList   │  │ IPC│  └─────────────────────────┘    │ │
│  │  │  - VariantTbl │  │    │                                 │ │
│  │  │  - FilterPane │  │    │  ┌─────────────────────────┐    │ │
│  │  │  - StatsView  │  │    │  │   Import Service        │    │ │
│  │  └───────────────┘  │    │  │   (JSON → SQLite)       │    │ │
│  │                     │    │  └─────────────────────────┘    │ │
│  │  ┌───────────────┐  │    │                                 │ │
│  │  │  Pinia Stores │  │    │  ┌─────────────────────────┐    │ │
│  │  │  - cases      │  │    │  │   Export Service        │    │ │
│  │  │  - variants   │  │    │  │   (Reports, CSV)        │    │ │
│  │  │  - filters    │  │    │  └─────────────────────────┘    │ │
│  │  └───────────────┘  │    │                                 │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
│                                           │                      │
│                                           ▼                      │
│                              ┌─────────────────────────┐        │
│                              │    SQLite Database      │        │
│                              │    (varlens.db)         │        │
│                              │                         │        │
│                              │  ├── cases              │        │
│                              │  ├── variants           │        │
│                              │  ├── annotations (JSON) │        │
│                              │  ├── variant_fts (FTS5) │        │
│                              │  └── statistics         │        │
│                              └─────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💾 Database Schema Design

### Core Tables

```sql
-- Cases/Samples table
CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT UNIQUE NOT NULL,          -- External ID from varvis
    sample_id TEXT,
    analysis_type TEXT,                     -- SNV, CNV, SV, etc.
    import_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,                          -- Flexible metadata storage
    phenotype JSON,                         -- HPO terms array
    family_info JSON                        -- Pedigree data
);
CREATE INDEX idx_cases_case_id ON cases(case_id);
CREATE INDEX idx_cases_analysis_type ON cases(analysis_type);

-- Main variants table
CREATE TABLE variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    chromosome TEXT NOT NULL,
    position INTEGER NOT NULL,
    ref TEXT NOT NULL,
    alt TEXT NOT NULL,
    variant_type TEXT,                      -- SNV, INDEL, CNV, SV
    gene_symbol TEXT,
    transcript TEXT,
    hgvs_c TEXT,                           -- Coding change
    hgvs_p TEXT,                           -- Protein change
    consequence TEXT,                       -- VEP consequence
    impact TEXT,                           -- HIGH, MODERATE, LOW, MODIFIER

    -- Frequencies
    gnomad_af REAL,
    gnomad_af_popmax REAL,

    -- Pathogenicity predictions
    cadd_score REAL,
    revel_score REAL,
    spliceai_score REAL,

    -- Clinical
    clinvar_classification TEXT,
    clinvar_id TEXT,
    acmg_classification TEXT,

    -- Quality
    quality_score REAL,
    read_depth INTEGER,
    allele_fraction REAL,

    -- Full annotation data
    annotations JSON,                       -- Complete JSON from varvis

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes
CREATE INDEX idx_variants_case ON variants(case_id);
CREATE INDEX idx_variants_position ON variants(chromosome, position);
CREATE INDEX idx_variants_gene ON variants(gene_symbol);
CREATE INDEX idx_variants_consequence ON variants(consequence);
CREATE INDEX idx_variants_clinvar ON variants(clinvar_classification);
CREATE INDEX idx_variants_impact ON variants(impact);

-- JSON indexes for common queries
CREATE INDEX idx_variants_gnomad ON variants(gnomad_af);
CREATE INDEX idx_variants_cadd ON variants(cadd_score);

-- Full-text search virtual table
CREATE VIRTUAL TABLE variants_fts USING fts5(
    gene_symbol,
    hgvs_c,
    hgvs_p,
    consequence,
    clinvar_classification,
    content='variants',
    content_rowid='id',
    tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER variants_ai AFTER INSERT ON variants BEGIN
    INSERT INTO variants_fts(rowid, gene_symbol, hgvs_c, hgvs_p, consequence, clinvar_classification)
    VALUES (new.id, new.gene_symbol, new.hgvs_c, new.hgvs_p, new.consequence, new.clinvar_classification);
END;

CREATE TRIGGER variants_ad AFTER DELETE ON variants BEGIN
    INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, hgvs_c, hgvs_p, consequence, clinvar_classification)
    VALUES ('delete', old.id, old.gene_symbol, old.hgvs_c, old.hgvs_p, old.consequence, old.clinvar_classification);
END;

-- Variant counts/statistics materialized view
CREATE TABLE variant_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gene_symbol TEXT,
    variant_type TEXT,
    consequence TEXT,
    clinvar_classification TEXT,
    case_count INTEGER,
    variant_count INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gene_symbol, variant_type, consequence, clinvar_classification)
);

-- Gene panels for virtual panel filtering
CREATE TABLE gene_panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    genes JSON,                             -- Array of gene symbols
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User filter presets
CREATE TABLE filter_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    filters JSON,                           -- Serialized filter configuration
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Query Optimization Strategies

```sql
-- Efficient variant counting across database
SELECT
    gene_symbol,
    COUNT(*) as variant_count,
    COUNT(DISTINCT case_id) as case_count
FROM variants
WHERE gnomad_af < 0.01 OR gnomad_af IS NULL
GROUP BY gene_symbol
ORDER BY variant_count DESC;

-- JSON field querying (when needed)
SELECT * FROM variants
WHERE json_extract(annotations, '$.inheritance') = 'de_novo';

-- FTS5 search
SELECT v.* FROM variants v
JOIN variants_fts fts ON v.id = fts.rowid
WHERE variants_fts MATCH 'BRCA*';
```

---

## ✨ Feature Specification

### Phase 1: Core MVP

#### Import System
- [ ] JSON file import (single file or batch)
- [ ] Drag-and-drop import interface
- [ ] Import progress indicator with ETA
- [ ] Duplicate detection (skip or update)
- [ ] Import validation and error reporting

#### Case Management
- [ ] Case list view with search and sort
- [ ] Case detail view with metadata
- [ ] Case deletion with cascade
- [ ] Case export to JSON

#### Variant Table
- [ ] Paginated data table (Vuetify v-data-table-server)
- [ ] Column visibility toggle
- [ ] Column sorting (multiple columns)
- [ ] Row selection for batch operations
- [ ] Variant detail drawer/dialog

#### Basic Filtering
- [ ] Gene symbol filter (autocomplete)
- [ ] Consequence filter (multi-select)
- [ ] Frequency filter (gnomAD AF threshold)
- [ ] ClinVar classification filter
- [ ] Impact filter (HIGH, MODERATE, LOW)

### Phase 2: Advanced Features

#### Enhanced Filtering
- [ ] Virtual gene panels (create, edit, apply)
- [ ] Inheritance filters (de novo, recessive, dominant)
- [ ] Quality filters (depth, allele fraction)
- [ ] Compound het detection
- [ ] Multi-sample family analysis

#### Statistics Dashboard
- [ ] Variant counts by gene
- [ ] Variant counts by consequence
- [ ] ClinVar distribution charts
- [ ] Frequency distribution histograms
- [ ] Case timeline

#### Search & Discovery
- [ ] Global FTS5 search
- [ ] Advanced query builder UI
- [ ] Saved search/filter presets
- [ ] Cross-case variant lookup

### Phase 3: Research Features

#### Cohort Analysis
- [ ] Multi-case selection
- [ ] Aggregate statistics
- [ ] Variant co-occurrence analysis
- [ ] Gene burden analysis

#### Reporting
- [ ] PDF report generation
- [ ] CSV/TSV export
- [ ] Filtered variant export
- [ ] Statistics export

#### External Links
- [ ] Links to ClinVar, gnomAD, OMIM
- [ ] PubMed search integration
- [ ] VarSome API integration (optional, online)

---

## 🎨 UI/UX Design Guidelines

### Layout Structure (inspired by varvis®)

```
┌──────────────────────────────────────────────────────────────┐
│  [Logo] Variant Viewer    [🔍 Global Search]    [⚙️] [🌓]   │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                  │
│  SIDEBAR   │              MAIN CONTENT AREA                  │
│            │                                                  │
│  📁 Cases  │  ┌──────────────────────────────────────────┐   │
│  └ Case 1  │  │  FILTER BAR                              │   │
│  └ Case 2  │  │  [Gene ▼] [Consequence ▼] [AF < 0.01 ▼]  │   │
│  └ Case 3  │  └──────────────────────────────────────────┘   │
│            │                                                  │
│  📊 Stats  │  ┌──────────────────────────────────────────┐   │
│            │  │  VARIANT TABLE                           │   │
│  🧬 Panels │  │  Gene | Position | Change | Cons | AF    │   │
│            │  │  ──────────────────────────────────────── │   │
│  ⚡ Presets│  │  BRCA1| chr17:... | c.68_69del | FS | 0  │   │
│            │  │  TP53 | chr17:... | c.215C>G   | MS | 1e-5│   │
│            │  └──────────────────────────────────────────┘   │
│            │                                                  │
│  ➕ Import │  [◀ 1 2 3 4 5 ... 100 ▶]  Showing 1-50 of 4,823│
└────────────┴─────────────────────────────────────────────────┘
```

### Design Principles

1. **Density**: Medical/research UX should be data-dense
2. **Familiarity**: Follow varvis® patterns where possible
3. **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation
4. **Performance**: Virtual scrolling for large datasets
5. **Dark Mode**: Essential for extended use

### Key Components

| Component | Purpose | Vuetify Component |
|-----------|---------|-------------------|
| Case Tree | Navigate cases | `v-treeview` |
| Variant Table | Display variants | `v-data-table-server` |
| Filter Chips | Active filters | `v-chip-group` |
| Detail Drawer | Variant details | `v-navigation-drawer` |
| Stats Cards | Quick metrics | `v-card` with charts |

---

## 📂 Project Structure

```
varlens/
├── .github/
│   └── workflows/
│       ├── build.yml           # Cross-platform build & release
│       ├── e2e.yml             # Playwright E2E tests
│       └── lint.yml            # Code quality checks
├── build/
│   ├── icon.png                # Linux icon
│   ├── icon.ico                # Windows icon
│   └── icon.icns               # macOS icon
├── electron/
│   ├── main.ts                 # Main process entry
│   ├── preload.ts              # Context bridge
│   └── services/
│       ├── database.ts         # SQLite operations
│       ├── import.ts           # JSON import logic
│       └── export.ts           # Export functionality
├── src/
│   ├── App.vue
│   ├── main.ts
│   ├── components/
│   │   ├── cases/
│   │   │   ├── CaseList.vue
│   │   │   └── CaseDetail.vue
│   │   ├── variants/
│   │   │   ├── VariantTable.vue
│   │   │   ├── VariantDetail.vue
│   │   │   └── VariantFilters.vue
│   │   ├── panels/
│   │   │   └── GenePanelManager.vue
│   │   ├── stats/
│   │   │   └── StatsDashboard.vue
│   │   └── common/
│   │       ├── AppHeader.vue
│   │       ├── AppSidebar.vue
│   │       └── ImportDialog.vue
│   ├── composables/
│   │   ├── useDatabase.ts
│   │   ├── useFilters.ts
│   │   └── useVariants.ts
│   ├── stores/
│   │   ├── cases.ts
│   │   ├── variants.ts
│   │   ├── filters.ts
│   │   └── settings.ts
│   ├── types/
│   │   ├── variant.ts
│   │   ├── case.ts
│   │   └── filter.ts
│   └── utils/
│       ├── formatters.ts
│       └── validators.ts
├── scripts/
│   └── migrations/             # Database migrations
├── tests/
│   ├── unit/                   # Vitest unit tests
│   ├── e2e/                    # Playwright E2E tests
│   └── fixtures/               # Test data (sample JSONs)
├── playwright-output/          # MCP traces & screenshots (gitignored)
├── .env.example                # Environment template
├── electron-builder.yml        # Build configuration
├── package.json
├── playwright.config.ts        # Playwright configuration
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🚀 Development Phases

### Phase 1: Foundation (Weeks 1-3)
- [ ] Project scaffolding with electron-vite
- [ ] Configure electron-builder for cross-platform builds
- [ ] Set up GitHub Actions CI/CD (build matrix: Ubuntu, Windows, macOS)
- [ ] SQLite integration with better-sqlite3
- [ ] Database schema implementation
- [ ] Basic IPC communication layer
- [ ] JSON import service
- [ ] Simple case list view
- [ ] **Playwright MCP setup for LLM development feedback**

### Phase 2: Core Features (Weeks 4-6)
- [ ] Variant table with pagination
- [ ] Basic filtering system
- [ ] FTS5 search implementation
- [ ] Case detail view
- [ ] Variant detail drawer
- [ ] Playwright E2E test suite (basic flows)

### Phase 3: Enhanced UX (Weeks 7-9)
- [ ] Advanced filter builder
- [ ] Virtual gene panels
- [ ] Filter presets (save/load)
- [ ] Dark/light theme
- [ ] Keyboard shortcuts
- [ ] Accessibility improvements (a11y audit via Playwright MCP)

### Phase 4: Statistics & Export (Weeks 10-12)
- [ ] Statistics dashboard
- [ ] Variant count aggregations
- [ ] CSV/TSV export
- [ ] PDF report generation
- [ ] Cross-case analysis

### Phase 5: Polish & Release (Weeks 13-14)
- [ ] Performance optimization
- [ ] Cross-platform testing (Windows, macOS, Linux)
- [ ] Code signing setup (Windows & macOS certificates)
- [ ] Error handling improvements
- [ ] User documentation
- [ ] Installer builds (Windows, macOS, Linux)
- [ ] Beta testing

---

## 🏷️ Project Name Brainstorming

### Naming Criteria
- Unique and SEO-friendly (easily googleable)
- Available on GitHub
- Memorable and pronounceable
- Reflects purpose (variants, offline, research)
- Does NOT contain "varvis" (independent branding)

### Verified Available Names (GitHub + Web Search Checked)

#### Top Recommendations

| Rank | Name | Rationale | GitHub | Web |
|------|------|-----------|--------|-----|
| 1 | **Alleleview** | Alleles + view, clear genomics focus | ✓ | ✓ |
| 2 | **Varlens** | Variants + lens (inspection metaphor) | ✓ | ✓ |
| 3 | **Chromoviz** | Chromosome + visualization | ✓ | ✓ |
| 4 | **Genoview** | Genomic + view, intuitive | ✓ | ✓ |
| 5 | **Seqnest** | Sequence + nest (local storage) | ✓ | ✓ |

#### Alternative Options

| Name | Rationale | GitHub | Web |
|------|-----------|--------|-----|
| **Variadex** | Variant + index (database focus) | ✓ | ✓ |
| **Allelion** | Allele + suffix (-ion suggests action) | ✓ | ✓ |
| **Genoquill** | Genome + quill (annotation focus) | ✓ | ✓ |
| **Varcrate** | Variant + crate (Rust-inspired, storage) | ✓ | ✓ |
| **Varseek** | Variant + seek (search focus) | ✓ | ✓ |

### Names to AVOID (Already Taken)

| Name | Conflict |
|------|----------|
| LAVA | [LAVA](https://github.com/josefin-werme/LAVA) - Local genetic correlation tool |
| Mutalyzer | [Mutalyzer](https://mutalyzer.nl/) - HGVS nomenclature checker |
| LocusLab | [CMU Locus Lab](https://github.com/locuslab) - ML research group |
| Varstation | [Varstation](https://varstation.com/) - NGS analysis platform |
| Allelica | [Allelica](https://eu.allelica.com/) - PRS software company |
| Sequenom | [Sequenom](https://en.wikipedia.org/wiki/Sequenom) - Acquired by LabCorp |
| GenoViewer | [GenoViewer](https://github.com/astrid/GenoViewer) - SAM/BAM viewer |
| GeneVault | [GeneVault](https://www.genevault.com/) - Genomics intelligence platform |
| Cutevariant | [Cutevariant](https://github.com/labsquare/cutevariant) - Variant browser |
| Helix | Multiple conflicts (HelixDB, Helix editor, Golden Helix) |

### Chosen Name: Varlens

**Varlens** was selected because:
- Unique and googleable (no existing software with this name)
- Short and memorable: "Variant + Lens" = inspection/viewing metaphor
- Professional and scientific sounding
- CLI-friendly: `varlens import sample.json`
- Works well as npm package: `@laborberlin/varlens` or `varlens`
- Domain potential: `varlens.app`, `varlens.io`

---

## 📚 Reference Documentation

### SQLite Resources
- [SQLite JSON1 Functions](https://sqlite.org/json1.html)
- [FTS5 Full-Text Search](https://sqlite.org/fts5.html)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

### Similar Projects
- [Cutevariant](https://github.com/labsquare/cutevariant) - Python variant browser
- [GenomicSQLite](https://github.com/mlin/GenomicSQLite) - Genomics SQLite extension
- [sqlite-search](https://github.com/berntpopp/sqlite-search) - Reference architecture

### Electron + Vue Resources
- [electron-vite](https://electron-vite.org/)
- [Vuetify 3 Documentation](https://vuetifyjs.com/)
- [Vue 3 Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)

### varvis Integration
- [varvis-download](https://github.com/LaborBerlin/varvis-download) - Data export CLI
- [varvis® Official](https://www.varvis.com/) - Source platform

---

## ⚠️ Considerations & Risks

### Technical Risks
| Risk | Mitigation |
|------|------------|
| Large JSON files slow import | Streaming JSON parser, chunked inserts |
| Complex queries slow on SQLite | Proper indexing, query optimization |
| Electron binary size | Tree-shaking, lazy loading |
| Cross-platform native module builds | Use @electron/rebuild, CI/CD matrix |

### Data Privacy
- Application runs fully offline
- No telemetry or analytics
- Database stored in user-controlled location
- Optional database encryption (sqlcipher)

### Performance Targets
| Metric | Target |
|--------|--------|
| Import 100k variants | < 30 seconds |
| Variant table render | < 100ms |
| Filter application | < 500ms |
| FTS5 search | < 200ms |
| Cold start | < 3 seconds |

---

## ✅ Next Steps

1. ~~**Finalize project name**~~ - ✅ **Varlens** selected
2. **Validate JSON structure** - Get sample export from varvis-download
3. **Create repository** - `github.com/LaborBerlin/varlens`
4. **Initialize project** - electron-vite template with Vue 3 + Vuetify 3
5. **Define JSON schema** - TypeScript interfaces for variant data
6. **Implement database layer** - SQLite service with migrations
7. **Build import MVP** - Basic JSON → SQLite pipeline
8. **Create variant table** - Core viewing functionality

---

*Document created: 2026-01-26*
*Author: Assisted by Claude*
*Project: Varlens*
*Status: Name Approved - Ready for Development*
