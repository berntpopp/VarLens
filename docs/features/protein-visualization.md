# Protein Visualization

VarLens includes an interactive protein visualization modal for exploring variant context at the protein and gene level. Access it from the Variant Details panel by clicking the DNA icon next to the gene symbol.

![Protein view button in the variant details panel](/screenshots/protein-viz-button.png)

## Opening the Viewer

1. Click any variant row in the variant table to open the Details panel
2. In the panel header, click the **DNA icon** (next to the gene name)
3. The protein visualization modal opens fullscreen with three tabs

## Lollipop Plot

The default tab shows your variant on a protein backbone alongside population and clinical data.

![Lollipop plot showing variant on protein with domains and gnomAD overlay](/screenshots/protein-viz-lollipop.png)

### Tracks (top to bottom)

- **Your variant** — Highlighted lollipop above the backbone with amino acid change label and gold border
- **Protein backbone** — Horizontal bar scaled to protein length with InterPro domain annotations (colored rectangles)
- **ClinVar track** — Diamond-shaped markers colored by clinical significance (red = Pathogenic, orange = Likely Pathogenic, yellow = VUS, green = Benign)
- **gnomAD track** — Population variant dots colored by consequence type, sized by density at each position

### Filters

Filter each track independently using the legend chips:

- **gnomAD Variants** — Filter by consequence type (Missense, Truncating, Inframe, Splice, Synonymous). Click a chip to toggle, click **only** to isolate one category, click **All** to reset.
- **ClinVar Significance** — Filter by pathogenicity (Pathogenic, Likely P., VUS, Likely B., Benign)
- **ClinVar Consequence** — Filter ClinVar variants by consequence type
- **AF filter** — Dropdown in the toolbar to filter gnomAD variants by allele frequency threshold

### Toolbar

- **Zoom** — Zoom in/out/reset buttons, or scroll-wheel to zoom, drag to pan
- **gnomAD toggle** — Show/hide the gnomAD population variant track (on by default)
- **Case variants** — Toggle to show other variants from the same case in the same gene
- **Export** — Download the plot as SVG or PNG

## Gene Structure

The Gene Structure tab shows exon/intron architecture from the canonical Ensembl transcript.

![Gene structure showing exons with variant position](/screenshots/protein-viz-gene-structure.png)

### Features

- **Exons** — Blue rectangles with exon numbers, sized proportionally
- **Introns** — Thin connecting lines between exons
- **Variant** — Your variant shown as a highlighted lollipop at its genomic position
- **ClinVar** — Diamond markers below the exon track (when loaded), with significance filters
- **Coordinates** — Chromosome position axis with assembly label (GRCh38)
- **Scale bar** — Shows the genomic distance scale

### Toolbar

Zoom controls, exon count indicator, gene length, and SVG/PNG export.

## 3D Structure

The 3D Structure tab renders the protein's predicted structure from AlphaFold using the Mol* (pdbe-molstar) viewer.

![3D protein structure with variant highlighted](/screenshots/protein-viz-3d-structure.png)

### Representations

Switch between three molecular representation styles:

- **Cartoon** — Secondary structure ribbons (default)
- **Surface** — Molecular surface envelope
- **Ball+Stick** — Atomic-level detail

### Variant Highlighting

- Your variant residue is highlighted in its consequence color on the 3D structure
- ClinVar P/LP variants are shown in the sidebar and highlighted on the structure
- Click any variant in the sidebar to zoom to its position

### Sidebar Filters

- **Your Variant** chip — Toggle visibility of your variant on the structure
- **ClinVar** chips — Filter by significance (Pathogenic, Likely P., VUS, Likely B., Benign) with **only** / **All** controls

### Confidence Coloring

AlphaFold structures display pLDDT confidence scores:

| Confidence | pLDDT Range | Color |
|---|---|---|
| Very high | > 90 | Dark blue |
| Confident | 70-90 | Light blue |
| Low | 50-70 | Yellow |
| Very low | < 50 | Orange |

## Data Sources

All data is fetched on demand and cached locally in SQLite:

| Source | Data | Cache |
|---|---|---|
| [UniProt](https://www.uniprot.org/) | Gene-to-protein mapping | 90 days |
| [InterPro](https://www.ebi.ac.uk/interpro/) | Protein domain annotations | 90 days |
| [AlphaFold DB](https://alphafold.ebi.ac.uk/) | Predicted 3D structures | 90 days |
| [Ensembl](https://rest.ensembl.org/) | Gene/exon coordinates | 90 days |
| [gnomAD](https://gnomad.broadinstitute.org/) | Population variant frequencies | 30 days |
| [gnomAD ClinVar](https://gnomad.broadinstitute.org/) | ClinVar variant annotations | 30 days |

::: tip Network Required
gnomAD and ClinVar data require an internet connection on first load. Subsequent views use cached data (even offline) until the cache expires.
:::
