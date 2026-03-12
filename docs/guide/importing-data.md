# Importing Data

VarLens supports importing variant data from JSON and VCF files.

## Supported Formats

VarLens accepts several JSON formats for variant data:

- **Columnar format:** `{ "CaseName": { "header": [...], "data": [[...]] } }` — tabular data with a header row and data arrays
- **Object format:** `{ "metadata": {...}, "samples": { "sampleId": { "variants": [...] } } }` — structured variant objects
- **Simple format:** `{ "variants": [...] }` — flat array of variant objects
- **VCF format:** Standard VCF v4.x files with VEP annotations

Files can be gzip-compressed (`.json.gz`).

For detailed format specifications, see [Supported Formats](../reference/supported-formats.md).

## Importing a Single Case

1. Click the **Import** button in the sidebar or use the toolbar menu
2. Select your variant file from the file dialog
3. Enter a case name (or accept the auto-generated name from the filename)
4. VarLens streams and imports the data, showing progress in real-time

![Import progress showing variants being loaded](/screenshots/importing-data.png)

## After Import

Once import completes, the case appears in the sidebar. Click it to open the variant table.

![Imported case visible in the sidebar](/screenshots/case-list.png)

## Batch Import

For importing multiple files at once, use the batch import feature available from the import menu. This processes multiple files sequentially and creates separate cases for each file.

## Tips

- Large files (>100,000 variants) may take a few minutes to import
- Import progress shows the current phase (reading, parsing, inserting) and variant count
- You can cancel an import in progress without losing previously imported data
