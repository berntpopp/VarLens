# Frequently Asked Questions

## General

### What is VarLens?

VarLens is a desktop application for offline genetic variant analysis. It runs entirely on your local machine — no data is uploaded to any server.

### Is VarLens free?

Yes, VarLens is open source under the MIT license.

### Which platforms are supported?

Windows 10+, macOS 12+, and Linux (Ubuntu 20.04+ or equivalent).

## Data & Privacy

### Is my data sent anywhere?

No. All data stays on your machine in a local SQLite database. The only outbound network requests are optional enrichment queries (VEP, gnomAD, ClinVar) that you trigger manually.

### Can I encrypt my database?

Yes, VarLens supports database encryption via SQLCipher (better-sqlite3-multiple-ciphers). You can set a password in the database settings.

### What happens if I delete a case?

The case and all its variants are permanently removed from the database. Global annotations (shared across cases) are preserved.

## Import

### My import is slow. What can I do?

Large files (>100,000 variants) take longer to import. SQLite writes are the main bottleneck. Ensure your disk is not heavily loaded during import.

### Can I import multiple files at once?

Yes, use the batch import feature to process multiple files sequentially.

## Analysis

### How does the ACMG classification work?

VarLens implements the ACMG/AMP evidence framework with Bayesian point-based scoring. You can quick-classify with a single click or use the detailed evidence editor to select specific criteria.

### Can I export my results?

Yes, use the export feature to download filtered variants as an Excel file (XLSX). Export respects your current filters and column selection.
