# Cohort Analysis

VarLens supports aggregating variants across multiple cases for cohort-level analysis.

![Cohort view showing aggregated variant data across cases](/screenshots/cohort-view.png)

## Switching to Cohort Mode

Use the mode toggle in the toolbar to switch between Case and Cohort views. Cohort mode aggregates all imported cases into a single table view.

## Cohort Table

The cohort table shows:

- **Carrier count** — Number of cases carrying each variant
- **Homozygous count** — Cases with homozygous genotype
- **Affected carriers** — Carriers with affected status
- All standard variant columns (gene, consequence, scores, etc.)

## Gene Burden Analysis

VarLens includes gene burden testing using Fisher's exact test to identify genes with statistically significant variant enrichment in affected versus unaffected cases.

## Filtering

Cohort view supports the same filtering capabilities as case view, plus additional cohort-specific filters for carrier count thresholds.
