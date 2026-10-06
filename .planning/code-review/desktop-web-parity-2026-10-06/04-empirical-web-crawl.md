## Step table

| # | Step | Status (raw) | Failed requests | Console errors | Note |
|---|---|---|---|---|---|
| 1 | auth: unauthenticated root redirects to login | OK |  | 0 | redirected to /login?next=%2F |
| 2 | auth: login wrong password | OK |  | 0 | stays on /login?next=%2F; message: VarLens Sign in to continue Invalid username or password. Username Password Sign in VarLens · genetic variant analysis |
| 3 | auth: login as admin | OK |  | 0 | landed on / |
| 4 | disclaimer: accept | OK |  | 0 | disclaimer shown and accepted |
| 5 | case-list: sidebar renders cases | OK |  | 0 | 3 cases listed |
| 6 | case-list: search cases | OK |  | 0 | filter 'HG006' -> 1 option(s) |
| 7 | case-list: cohort + HPO filter comboboxes | OK |  | 0 | field 0: (no menu) \|\| field 1: No data available \|\| field 2: No data available |
| 8 | case: select HG006 (shortlist tab) | OK |  | 0 | Case HG006 Shortlist SNV/Indel 1793 HG006 (female) No clinical phenotypes recorded Tier 1 candidates Preset Scored (capped): 0 → top 0 (5ms) Refresh 0 variants No variants matched the shortlist filters. |
| 9 | case: shortlist preset switch | OK |  | 0 | presets: Tier 1 candidates \| All rare damaging \| Recessive candidates; now: Scored (capped) |
| 10 | variant-table: SNV/Indel tab loads | OK |  | 0 | 25 rows; 1,793 / 1,793 (1-25 of 1793) |
| 11 | variant-table: sort by Position | OK |  | 0 | asc first:  chr22 29,001,799 T TTATC 0/1 ZNRF3 -- intron variant MODIFIER ENST00000544604 ENST0000054 \|\| desc first:  chr22 30,499,995 A G 0/1 SEC14L4 -- intron variant MODIFIER ENST00000255858 ENST000002558 |
| 12 | variant-table: sort by Gene | OK |  | 0 | asc first:  chr22 29,323,178 G T 1/1 AP1B1 -- Downstream MODIFIER ENST00000357586 -- -- 0.1970 -- 50. \|\| desc first:  chr22 29,001,799 T TTATC 0/1 ZNRF3 -- intron variant MODIFIER ENST00000544604 ENST0000054 |
| 13 | variant-table: sort by gnomAD AF | OK |  | 0 | asc first:  chr22 29,506,048 C T 1/1 THOC5 -- 3 prime UTR variant MODIFIER ENST00000490103 ENST000004 \|\| desc first:  chr22 29,025,450 A G 1/1 ZNRF3 -- intron variant MODIFIER ENST00000544604 ENST00000544604 |
| 14 | variant-table: sort by CADD | OK |  | 0 | asc first:  chr22 29,001,799 T TTATC 0/1 ZNRF3 -- intron variant MODIFIER ENST00000544604 ENST0000054 \|\| desc first:  chr22 29,001,799 T TTATC 0/1 ZNRF3 -- intron variant MODIFIER ENST00000544604 ENST0000054 |
| 15 | variant-table: column header filter (Gene) | OK |  | 0 | header filter popup opened; harness typed into the first visible input and the count stayed 1,793 - inconclusive (not counted as a failure). |
| 16 | variant-table: text search (gene) | OK |  | 0 | after search ZNRF3: 83 / 1,793 (1-25 of 83) |
| 17 | variant-table: DSL search gnomad_af:<:0.01 | OK |  | 0 | after DSL: 95 / 1,793 (1-25 of 95) |
| 18 | variant-table: filter drawer (Impact MOD + AF<=1%) | OK |  | 0 | MOD: 14 / 1,793 (1-14 of 14); MOD+AF<=1%: 0 / 1,793 (0-0 of 0) |
| 19 | variant-table: filter drawer expand all groups | OK |  | 0 | All Filters 2 Variant Properties Search Presets Save Parity crawl preset Rare Pathogenic Tier 1 candidates All rare damaging Rare HIGH Rare HIGH+MOD Recessive candidates Ultra Rare HIGH ClinVar P/LP HIGH Impact Rare (1%) CADD >= 20 Gene Gene Panels Padding 0 1kb 5kb 10kb Manage Panels Impact Active  |
| 20 | variant-table: ClinVar + Consequence + Tags filter groups | OK |  | 0 | expanded: ClinVar, Consequence, Tags, Annotations, Internal Frequency, Structural Variants |
| 21 | variant-table: filter preset chip (Rare (1%)) | OK |  | 0 | after preset: 95 / 1,793 (1-25 of 95) |
| 22 | filter-presets: save current filters as preset | ERROR | 500 POST /api/presets/create | 1 | Rerun with an existing name: 500 /api/presets/create {code: UNIQUE_CONSTRAINT, "name ... already exists"} (500 for a validation conflict). First-time save in an earlier pass succeeded and the chip appeared. |
| 23 | filter-presets: manage presets + delete crawl preset | OK (NOT-FOUND-IN-UI) |  | 0 | Manage Presets dialog lists user preset with "Hide preset" + "Delete preset" buttons (harness matched the wrong accessible name; delete not executed). |
| 24 | variant-table: columns panel toggle + reset | OK |  | 0 | after toggling Qual: 25 of 26 columns visible, Qual header visible=false; reset clicked |
| 25 | variant-table: pagination (next page, page size) | OK |  | 0 | before 1,793 / 1,793 (1-25 of 1793); after next 1,793 / 1,793 (26-50 of 1793); after page-size change 1,793 / 1,793 (26-50 of 1793) |
| 26 | variant-details: open MOD (missense) row | OK |  | 0 | Variant Details C22orf31 ENST00000216071:ENST00000216071.5:c.136T>C ENSP00000216071.4:p.Cys46Arg chr22:29,060,711 A > G rsID: N/A Transcripts 1 Fetch VEP Source Transcript Gene Consequence cDNA Protein Status Import ENST00000216071 C22orf31 MODERATE ENST00000216071.5:c.136T>C ENSP00000216071.4:p.Cys |
| 27 | variant-details: Fetch VEP (+ MyVariant/SpliceAI enrichment) | ERROR | 501 POST /api/vep/fetch<br>404 POST /api/myvariant/fetch<br>404 POST /api/spliceai/fetch | 3 | panel: Transcripts 1 Fetch VEP Source Transcript Gene Consequence cDNA Protein Status Import ENST00000216071 C22orf31 MODERATE ENST00000216071.5:c.136T>C ENSP000002160 … scores: Annotation Scores CADD -- gnomAD 0.050 No additional scores available for this variant ACMG Classification P LP VUS LB B \ |
| 28 | variant-details: expand transcript table | OK |  | 0 | expanded view: (inline) |
| 29 | protein-view: open modal (structure/lollipop/gnomAD ClinVar) | ERROR |  | 0 | Protein view not available in web mode The protein structure, domain, and ClinVar lollipop views rely on external annotation services that the web server does not provide yet. Open this variant in the VarLens desktop app to use them. Close |
| 30 | acmg: evidence editor (PM2 + PP3 autosave) | OK |  | 0 | ACMG Classification P LP VUS LB B Evidence editor (has evidence) Uncertain significance 4 net pts Auto-suggest Override Pathogenic criteria +4 pts Very Strong ( |
| 31 | acmg: auto-suggest + evidence notes | OK |  | 0 | ACMG Classification P LP VUS LB B Evidence editor (has evidence) Uncertain significance 4 net pts Auto-suggest Override Pathogenic criteria +4 pts Very Strong  |
| 32 | acmg: quick classify via LP chip | OK |  | 0 | overlay: (none); panel: ACMG Classification P LP VUS LB B Evidence editor (has evidence) Uncertain significance 2 net pts Auto-suggest Override |
| 33 | tags: create tag via Settings > Custom Tags | OK |  | 0 | tag created |
| 34 | tags: assign tag to variant | OK (ERROR) |  | 0 | harness artifact: tag was already assigned from an earlier pass, so the click toggled it off (200 /api/tags/removeVariantTag). Assignment itself returned 200 /api/tags/assignVariantTag and showed the chip in pass 3. |
| 35 | comments: add global comment | OK (ERROR) |  | 0 | harness artifact (blur not delivered). Manual re-check: typing + blur -> 200 /api/annotations/upsertGlobal, comment rendered with timestamp. |
| 36 | comments: add case comment | OK (ERROR) |  | 0 | harness artifact. Manual re-check: 200 /api/annotations/upsertPerCase, comment rendered. |
| 37 | variant-details: activity log | OK |  | 0 | Activity Log Activity Log ACMG Classification changed 10/6/2026, 5:51:02 PM none → Uncertain significance ACMG Evidence updated 10/6/2026, 5:51:02 PM ACMG Classification changed 10/6/2026, 5:51:03 PM Uncertain significance → Uncertain significance ACMG Evidence updated 10/6/2026, 5:51:03 PM ACMG Cla |
| 38 | variant-details: external links (ClinVar, gnomAD) | OK | net::ERR_ABORTED POST https://region1.google-analytics.com/g/collect | 0 | popups opened: https://www.ncbi.nlm.nih.gov/clinvar/search/?term=chr22%3A29060711%3AA%3AG , https://gnomad.broadinstitute.org/variant/chr22-29060711-A-G?dataset=gnomad_r2_1 |
| 39 | variant-details: broadcast to local IGV | ERROR |  | 3 | Blocked by the web Content-Security-Policy: console "Connecting to http://localhost:60151/goto?... violates connect-src". No user feedback (no snackbar). |
| 40 | variant-details: copy HGVS | OK |  | 0 | snackbar: (none) |
| 41 | shortlist: star variant + starred-only filter | OK |  | 0 | starred-only: 2 / 1,793 (1-2 of 2); shortlist tab: Case HG006 Shortlist SNV/Indel 1793 HG006 (female) No clinical phenotypes recorded Tier 1 candidates Preset Scored (capped): 0 → top 0 (3ms) Refresh 0 variants No variants matched the shortlist filter |
| 42 | export: case export menu + every option | ERROR |  | 0 | no menu; click result snackbar: "Export failed: variant export is not available for PostgreSQL yet. Close" |
| 43 | case-metadata: open modal (overview) | OK |  | 0 | HG006 1,793 variants Imported Oct 6, 2026 Overview Comments Metrics Data Info Status Unknown Sex Female Age DOB Cohorts Phenotypes No phenotype terms assigned |
| 44 | case-metadata: HPO term search + add | ERROR | 501 POST /api/hpo/search | 1 | placeholder "Search HPO terms..."; 0 suggestions for 'seizure' |
| 45 | case-metadata: set sex via overview | OK |  | 0 | HG006 1,793 variants Imported Oct 6, 2026 Overview Comments Metrics Data Info Status Unknown Sex Female Age DOB Cohorts Phenotypes No phenotype terms assigned |
| 46 | case-metadata: comments tab create | OK |  | 0 | comment listed |
| 47 | case-metadata: metrics tab (create definition) | OK |  | 0 | metric picker: Body Mass Index (BMI) Body Surface Area (BSA) Head Circumference Height Weight Albumin Ammonia Bicarbonate (CO2) Blood Urea Nitrogen (BUN) Calcium (Ionized) Calcium (Total) Chloride Creatinine Estimat |
| 48 | case-metadata: data info tab | OK |  | 0 | HG006 1,793 variants Imported Oct 6, 2026 Overview Comments Metrics Data Info Import Information Source file File format Sequencing Platform Platform Platform details External IDs No external IDs added yet ID type Value Add Pre-filtering Applied Allele frequency filter Quality filter Parity list (3  |
| 49 | gene-lists: create gene list | OK (ERROR) |  | 0 | harness artifact on rerun (list already existed, dialog title "Edit Gene List"). Manual re-check: list "Parity list" persisted with BRCA1/TP53/NOTAGENE1; editor says "3 gene(s) recognized" including the bogus NOTAGENE1. |
| 50 | region-files: import BED | ERROR | 500 POST /api/regionFiles/create | 1 | Rerun with an existing name: 500 /api/regionFiles/create "duplicate key value violates unique constraint region_files_name_key", user sees generic "An unexpected error occurred". First-time import in pass 3 succeeded (region listed). |
| 51 | cohort: switch to cohort mode | OK |  | 0 | step started from case reset; cohort mode itself verified by all following cohort steps (2,347 unique variants, 3 cases). |
| 52 | cohort: tabs present | OK |  | 0 | tabs: Variants \| Gene Burden |
| 53 | cohort-table: sort by Gene | OK |  | 0 | asc:  chr22 29,323,178 G T AP1B1 ENST00000357586 -- -- MODIFIER downstream_gene_variant -- 0.19 \|\| desc:  chr22 29,001,472 C CTTTTT ZNRF3 ENST00000544604 ENST00000544604.7:c.426+14284_426+14288du |
| 54 | cohort-table: sort by Position | OK |  | 0 | asc:  chr22 29,001,472 C CTTTTT ZNRF3 ENST00000544604 ENST00000544604.7:c.426+14284_426+14288du \|\| desc:  chr22 30,499,995 A G SEC14L4 ENST00000255858 ENST00000255858.12:c.130+3682T>C -- MODIFIER |
| 55 | cohort-table: sort by gnomAD AF | OK |  | 0 | asc:  chr22 29,055,804 G A C22orf31 ENST00000216071 -- -- MODIFIER downstream_gene_variant -- 0 \|\| desc:  chr22 29,025,450 A G ZNRF3 ENST00000544604 ENST00000544604.7:c.427-17045A>G -- MODIFIER i |
| 56 | cohort-table: text search | OK |  | 0 | after ZNRF3: 113 / 2,347 (1-25 of 113) |
| 57 | cohort-table: filter drawer (MOD) | OK |  | 0 | with MOD: 23 / 2,347 (1-23 of 23) |
| 58 | cohort-table: inheritance / analysis-group filter group | NOT-FOUND-IN-UI |  | 0 | no Inheritance/analysis-group filter in cohort drawer |
| 59 | cohort-table: columns panel | OK |  | 0 | columns panel: 18 of 18 columns visible |
| 60 | cohort-table: row click -> details / carriers | OK |  | 0 | Variant Details ZNRF3 ENST00000544604:ENST00000544604.7:c.426+14602_426+14605dup chr22:29,001,799 T > TTATC rsID: N/A Transcripts Fetch VEP No transcript annotations available for this variant. Annotation Scores Scores available in Case Analysis mode ACMG Classification P LP VUS LB B Evidence editor |
| 61 | cohort: gene burden tab | OK |  | 0 | Cohort analysis GRCh38 (3 cases) Genome Build SNV/Indel Variant Type Variants Gene Burden Gene Burden Analysis Group A (Cases) Load from cohort group Any Affected status Any Sex Select all 0 / 3 cases HG007 HG006 HG005 Group B (Controls) Load from cohort group Any Affected status Any Sex Select all  |
| 62 | cohort: run association (gene burden compare) | ERROR (OK) |  | 0 | Harness left Run Analysis disabled (no groups picked). Manual re-check: picked HG007 (A) / HG005 (B) -> 501 /api/cohort/runAssociation, UI shows "Analysis failed: [object Object]". |
| 63 | cohort: export | ERROR |  | 0 | download: none; snackbar: "cohort export is not available for PostgreSQL yet. Close"; overlay: Export 2,347 variants to Excel |
| 64 | cohort: case-filter comboboxes (cohort/HPO) | OK |  | 0 | GRCh38 (3 cases) Genome Build: GRCh38 (3 cases) \|\| SNV/Indel Variant Type: SNV/Indel SV CNV STR \|\| :  |
| 65 | settings: menu contents | OK |  | 0 | Data Database Overview Import Data Ctrl+I Settings External Links Custom Tags Gene Panels Application Preferences Reset Preferences Reset Columns Restore default column visibility and order Reset Filters Restore default filter group arrangement Danger Zone Delete All Cases Remove all cases from data |
| 66 | settings: Database Overview | OK |  | 0 | Database Overview At a Glance 3 Total Cases 5,187 Total Variants 2,347 Unique Variants 36 Genes with Variants 0 Starred Variants 0 ACMG Classified Cohort Groups (0) No cohort groups defined. Tags (0) No tags defined. Top Phenotypes (0) No phenotypes assigned to any case. |
| 67 | settings: External Links (toggle + save) | OK |  | 0 | toggled first switch twice; snackbar:  |
| 68 | settings: Custom Tags (create + delete tag) | OK |  | 0 | tag created; deleted |
| 69 | panels: open Gene Panels manager | ERROR | 501 POST /api/geneRef/info | 1 | Gene Panels New Panel Import PanelApp StringDB Generate Name Version Source Genes Created Actions API parity panel - custom 2 10/6/2026  |
| 70 | panels: New Panel (autocomplete + paste list validate) | ERROR | 501 POST /api/geneRef/info<br>404 POST /api/panels/autocomplete<br>404 POST /api/panels/validateSymbols | 3 | autocomplete options: 0; paste dialog: ; Save enabled: false |
| 71 | panels: Import PanelApp (search) | ERROR | 501 POST /api/geneRef/info<br>404 POST /api/panels/searchPanelApp | 2 | Import from PanelApp Search panels... Both UK Australia Unknown API method. Cancel Import |
| 72 | panels: StringDB Generate | ERROR | 501 POST /api/geneRef/info<br>404 POST /api/panels/generateStringDb | 2 | Generate from StringDB Seed genes (one per line, or comma/semicolon separated) 2 genes parsed Presets High-confidence physical Medium functional Broad exploration Score threshold: 400 Network type Physical Functional Panel name (optional) Unknown API method. Cancel Generate |
| 73 | panels: API-created panel row actions (view/export BED) | ERROR | 501 POST /api/geneRef/info<br>404 POST /api/panels/exportBed | 2 | row buttons: Edit \| Copy \| Export \| Delete; export BED -> no download; snackbar:  |
| 74 | panels: activate panel filter in case view | NOT-FOUND-IN-UI |  | 0 | panel not offered in filter group |
| 75 | settings: Application Preferences (toggle + save) | OK |  | 0 | Application Preferences Display Display Name Used for audit trail 25 Items Per Page Case View Shortlist (ranked view) Default active tab Which tab to open first when you navigate into a case Performance Worker Threads Auto: 31 threads · Takes effect on next database open Pre-fetch next page Settings |
| 76 | settings: Reset Columns | OK |  | 0 | clicked; snackbar:  |
| 77 | settings: Reset Filters | OK |  | 0 | clicked; snackbar:  |
| 78 | settings: Delete All Cases dialog (open + cancel) | ERROR (OK) |  | 0 | No confirmation dialog; snackbar "all-case deletion is not available for PostgreSQL yet." (capabilities.cases.deleteAll=false). Manual re-check. |
| 79 | db-picker: VarLens Web menu | OK |  | 0 | web:postgres |
| 80 | db-picker: toolbar "VarLens" title button | OK |  | 0 | title element is in the a11y tree as a button but not visible (hidden); no picker in web. |
| 81 | theme toggle: search UI | NOT-FOUND-IN-UI |  | 0 | no theme toggle button in toolbar/footer |
| 82 | footer: version/about | OK |  | 0 | Manual re-check: menu shows "VarLens v0.73.0 / Electron vweb" (cosmetic: Electron label in web). |
| 83 | footer: license | OK |  | 0 | (no dialog) popups: https://opensource.org/license/MIT |
| 84 | footer: disclaimer | OK |  | 0 | Research Use Only VarLens is a research analysis tool designed for the exploration of genomic variant data. Before proceeding, please be aware of the following important limitations. Not for Diagnostic Use This tool is intended for research purposes  |
| 85 | footer: FAQ | OK |  | 0 | Frequently Asked Questions Search questions... GENERAL What is VarLens designed for? Who should use this tool? What are the system requirements? DATA What file formats are supported? How is my data stored? Can I export filtered results? INTERPRETATIO |
| 86 | footer: keyboard shortcuts | OK |  | 0 | Keyboard Shortcuts Table Navigation ↑ / ↓ Move selection up / down Enter Open variant detail panel Escape Close detail panel / deselect row Actions (on selected row) s Toggle star c Open comment dialog a Open ACMG classification e Expand / collapse r |
| 87 | footer: documentation link | OK |  | 0 | (no dialog) popups: https://berntpopp.github.io/VarLens/ |
| 88 | footer: GitHub link | OK |  | 0 | (no dialog) popups: https://github.com/berntpopp/varlens |
| 89 | logs: log viewer | OK |  | 0 | Manual re-check: log viewer panel opens (Download/Clear/Close, memory readout); it overlays the footer so the footer toggle can no longer be clicked to close it - use its own Close button. |
| 90 | import: single JSON file (demo-case.json) | OK |  | 0 | Import Data 1. Source 2. Review 3. Import 4. Summary Succeeded: 1 demo-case.json (50 variants) Done |
| 91 | import: multiple files (SV + STR VCF) | OK |  | 0 | Import Data 1. Source 2. Review 3. Import 4. Summary Succeeded: 2 synthetic-sv.vcf (5 variants) synthetic-str.vcf (4 variants) Done |
| 92 | import: folder (webkitdirectory) | OK |  | 0 | Import Data 1. Source 2. VCF Preview 3. Import 4. Summary Succeeded: 1 SAMPLE1 (3 variants) Done |
| 93 | import: ZIP archive | ERROR (OK) |  | 0 | Unencrypted ZIP is reported as "ZIP is password-protected". API repro: upload 200 -> batch-import:testZipPassword(ref, "") 200 {success:false} -> extractZip 200 {files:[]}. ZIP import unusable in web. |
| 94 | import: duplicate case name (HG005 again) | ERROR | 500 POST /api/import/start | 1 | Import Data 1. Source 2. VCF Preview 3. Import 4. Summary Succeeded: 0 Failed: 1 HG005 Error: An unexpected error occurred. Please try again. Done |
| 95 | jobs: jobs list UI | NOT-FOUND-IN-UI |  | 0 | no jobs/background-task UI found |
| 96 | cases: delete a crawl-imported case | OK |  | 0 | deleted Affected status unknown, Sex unknown synthetic-str.vcf 4 variants • 1m ago; snackbar: Deleted "synthetic-str.vcf" Close |
| 97 | admin: user management UI | NOT-FOUND-IN-UI |  | 0 | no user-management/admin entry in toolbar, settings menu, DB-picker menu or footer |
| 98 | auth: logout UI | NOT-FOUND-IN-UI |  | 0 | no logout control in toolbar, DB-picker menu, settings menu or footer |
| 99 | auth: change password UI | NOT-FOUND-IN-UI |  | 0 | no change-password control visible |
| 100 | auth: logout via API then reload | OK |  | 0 | logout api: 200 {"ok":true}; after reload at /login?next=%2F |
| 101 | auth: re-login | OK |  | 0 | back at /; 6 cases listed |
| 102 | session: reload keeps selected case? (URL state) | OK |  | 0 | before reload url / title "HG006 · Case · VarLens"; after reload url / title "VarLens" |

Counts: {"OK":78,"ERROR":17,"NOT-FOUND-IN-UI":7}

## Failed requests grouped by endpoint + status

| Endpoint | Steps affected | Response body excerpt |
|---|---|---|
| 404 POST /api/myvariant/fetch | variant-details: Fetch VEP (+ MyVariant/SpliceAI enrichment) | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"myvariant","method":"fetch"}} |
| 404 POST /api/panels/autocomplete | panels: New Panel (autocomplete + paste list validate) | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"panels","method":"autocomplete"}} |
| 404 POST /api/panels/exportBed | panels: API-created panel row actions (view/export BED) | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"panels","method":"exportBed"}} |
| 404 POST /api/panels/generateStringDb | panels: StringDB Generate | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"panels","method":"generateStringDb"}} |
| 404 POST /api/panels/searchPanelApp | panels: Import PanelApp (search) | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"panels","method":"searchPanelApp"}} |
| 404 POST /api/panels/validateSymbols | panels: New Panel (autocomplete + paste list validate) | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"panels","method":"validateSymbols"}} |
| 404 POST /api/spliceai/fetch | variant-details: Fetch VEP (+ MyVariant/SpliceAI enrichment) | {"code":"NOT_FOUND","message":"unknown method","userMessage":"Unknown API method.","details":{"domain":"spliceai","method":"fetch"}} |
| 500 POST /api/import/start | import: duplicate case name (HG005 again) | {"code":"UNKNOWN","message":"case 'HG005' already exists","userMessage":"An unexpected error occurred. Please try again."} |
| 500 POST /api/presets/create | filter-presets: save current filters as preset | {"code":"UNIQUE_CONSTRAINT","message":"name 'Parity crawl preset' already exists","userMessage":"name 'Parity crawl preset' already exists"} |
| 500 POST /api/regionFiles/create | region-files: import BED | {"code":"UNKNOWN","message":"duplicate key value violates unique constraint \"region_files_name_key\"","userMessage":"An unexpected error occurred. Please try again."} |
| 501 POST /api/geneRef/info | panels: open Gene Panels manager; panels: New Panel (autocomplete + paste list validate); panels: Import PanelApp (search); panels: StringDB Generate; panels: API-created panel row actions (view/export BED) | {"code":"UNKNOWN","message":"geneRef.info is not available in web mode yet.","userMessage":"geneRef.info is not available in web mode yet.","details":{"error":"unsupported-web-capability","capability" |
| 501 POST /api/hpo/search | case-metadata: HPO term search + add | {"code":"UNKNOWN","message":"hpo.search is not available in web mode yet.","userMessage":"hpo.search is not available in web mode yet.","details":{"error":"unsupported-web-capability","capability":"hp |
| 501 POST /api/vep/fetch | variant-details: Fetch VEP (+ MyVariant/SpliceAI enrichment) | {"code":"UNKNOWN","message":"vep.fetch is not available in web mode yet.","userMessage":"vep.fetch is not available in web mode yet.","details":{"error":"unsupported-web-capability","capability":"vep. |
| net::ERR_ABORTED POST https://region1.google-analytics.com/g/collect | variant-details: external links (ClinVar, gnomAD) |  |

## API probe (authenticated RPC)

| Key | Static class | Called | Status | Error |
|---|---|---|---|---|
| cases:list | override | yes | 200 |  |
| cases:query | read-task | yes | 200 |  |
| cases:delete | override | no (destructive/side-effect: skipped) |  |  |
| cases:deleteAll | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| cases:deleteBatch | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| cases:availableBuilds | read-task | yes | 200 |  |
| variants:query | override | yes | 200 |  |
| variants:getFilterOptions | override | yes | 200 |  |
| variants:search | override | yes | 200 |  |
| variants:geneSymbols | read-task | yes | 200 |  |
| variants:typeCounts | read-task | yes | 200 |  |
| variants:columnMeta | override | yes | 400 | UNKNOWN: invalid-column-meta-payload |
| variants:typesPresent | read-task | yes | 200 |  |
| variants:shortlist | read-task | yes | 500 | UNKNOWN: Cannot use 'in' operator to search for 'adHocConfig' in 2 |
| import:start | override | no (destructive/side-effect: skipped) |  |  |
| import:startMultiFile | override | no (destructive/side-effect: skipped) |  |  |
| import:vcfPreview | override | yes | 403 | UNKNOWN: Server-path import is disabled in web mode. Use browser upload refs instead. |
| import:vcfMultiPreview | override | yes | 403 | UNKNOWN: Server-path import is disabled in web mode. Use browser upload refs instead. |
| import:cancel | override | yes | 200 |  |
| export:variants | override | yes | 501 | UNKNOWN: export.variants is not available in web mode yet. |
| export:cohort | override | yes | 501 | UNKNOWN: export.cohort is not available in web mode yet. |
| database:selectFile | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| database:selectSaveLocation | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| database:open | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:create | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:rekey | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:info | override | yes | 200 |  |
| database:capabilities | override | yes | 200 |  |
| database:postgresDiagnostics | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| database:postgresProfilesList | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| database:postgresProfileSave | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:postgresProfileRemove | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:postgresProfileTest | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| database:postgresProfileOpen | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:recentList | override | yes | 200 |  |
| database:getOverview | override | yes | 200 |  |
| database:removeRecent | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:deleteFile | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| database:showInFolder | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| batch-import:checkDuplicates | override | yes | 200 |  |
| batch-import:start | override | no (destructive/side-effect: skipped) |  |  |
| batch-import:cancel | override | yes | 200 |  |
| batch-import:testZipPassword | override | yes | 403 | UNKNOWN: Server-path import is disabled in web mode. Use browser upload refs instead. |
| batch-import:extractZip | override | no (destructive/side-effect: skipped) |  |  |
| batch-import:cleanupZipTemp | override | no (destructive/side-effect: skipped) |  |  |
| cohort:getVariants | override | yes | 200 |  |
| cohort:getColumnMeta | override | yes | 200 |  |
| cohort:getSummary | override | yes | 200 |  |
| cohort:getCarriers | override | yes | 200 |  |
| cohort:getGeneBurden | override | yes | 200 |  |
| cohort:runAssociation | override | yes | 501 | UNKNOWN: cohort.runAssociation is not available in web mode yet. |
| cohort:cancelAssociation | override | yes | 501 | UNKNOWN: cohort.cancelAssociation is not available in web mode yet. |
| cohort:getSummaryStatus | override | yes | 200 |  |
| cohort:rebuildSummary | override | yes | 501 | UNKNOWN: cohort.rebuildSummary is not available in web mode yet. |
| annotations:getGlobal | override | yes | 200 |  |
| annotations:upsertGlobal | override | no (write method: skipped) |  |  |
| annotations:deleteGlobal | write-task | no (write method: skipped) |  |  |
| annotations:getPerCase | read-task | yes | 200 |  |
| annotations:upsertPerCase | override | no (write method: skipped) |  |  |
| annotations:deletePerCase | write-task | no (write method: skipped) |  |  |
| annotations:getForVariant | override | yes | 200 |  |
| annotations:batchGet | read-task | yes | 200 |  |
| vep:fetch | override | yes | 501 | UNKNOWN: vep.fetch is not available in web mode yet. |
| vep:cancel | override | yes | 501 | UNKNOWN: vep.cancel is not available in web mode yet. |
| vep:clearCache | override | yes | 501 | UNKNOWN: vep.clearCache is not available in web mode yet. |
| vep:getCacheStats | override | yes | 501 | UNKNOWN: vep.getCacheStats is not available in web mode yet. |
| hpo:search | override | yes | 501 | UNKNOWN: hpo.search is not available in web mode yet. |
| hpo:clearCache | override | yes | 501 | UNKNOWN: hpo.clearCache is not available in web mode yet. |
| myvariant:fetch | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| myvariant:clearCache | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| spliceai:fetch | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| spliceai:clearCache | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| case-metadata:get | read-task | yes | 200 |  |
| case-metadata:upsert | write-task | no (write method: skipped) |  |  |
| case-metadata:getFullMetadata | read-task | yes | 200 |  |
| case-metadata:listCohorts | read-task | yes | 200 |  |
| case-metadata:createCohort | override | no (write method: skipped) |  |  |
| case-metadata:updateCohort | write-task | no (write method: skipped) |  |  |
| case-metadata:deleteCohort | write-task | no (write method: skipped) |  |  |
| case-metadata:getCohortByName | read-task | yes | 200 |  |
| case-metadata:getCaseCohorts | read-task | yes | 200 |  |
| case-metadata:assignCohort | write-task | no (write method: skipped) |  |  |
| case-metadata:removeCohort | write-task | no (write method: skipped) |  |  |
| case-metadata:setCohorts | write-task | no (write method: skipped) |  |  |
| case-metadata:getHpoTerms | read-task | yes | 200 |  |
| case-metadata:assignHpoTerm | write-task | no (write method: skipped) |  |  |
| case-metadata:removeHpoTerm | write-task | no (write method: skipped) |  |  |
| case-metadata:getDataInfo | read-task | yes | 200 |  |
| case-metadata:upsertDataInfo | write-task | no (write method: skipped) |  |  |
| case-metadata:listExternalIds | read-task | yes | 200 |  |
| case-metadata:upsertExternalId | write-task | no (write method: skipped) |  |  |
| case-metadata:deleteExternalId | write-task | no (write method: skipped) |  |  |
| case-metadata:distinctHpoTerms | read-task | yes | 200 |  |
| case-metadata:distinctPlatforms | read-task | yes | 200 |  |
| case-metadata:distinctExternalIdTypes | read-task | yes | 200 |  |
| case-comments:list | read-task | yes | 200 |  |
| case-comments:create | write-task | no (write method: skipped) |  |  |
| case-comments:update | write-task | no (write method: skipped) |  |  |
| case-comments:delete | write-task | no (write method: skipped) |  |  |
| case-metrics:listDefinitions | read-task | yes | 200 |  |
| case-metrics:createDefinition | write-task | no (write method: skipped) |  |  |
| case-metrics:listForCase | read-task | yes | 200 |  |
| case-metrics:upsert | write-task | no (write method: skipped) |  |  |
| case-metrics:delete | write-task | no (write method: skipped) |  |  |
| transcripts:list | override | yes | 200 |  |
| transcripts:switch | override | no (write method: skipped) |  |  |
| transcripts:insertAndSwitch | override | no (write method: skipped) |  |  |
| tags:list | read-task | yes | 200 |  |
| tags:create | write-task | no (write method: skipped) |  |  |
| tags:update | write-task | no (write method: skipped) |  |  |
| tags:delete | write-task | no (write method: skipped) |  |  |
| tags:getUsageCount | read-task | yes | 200 |  |
| tags:getVariantTags | read-task | yes | 200 |  |
| tags:assignVariantTag | write-task | no (write method: skipped) |  |  |
| tags:removeVariantTag | write-task | no (write method: skipped) |  |  |
| tags:setVariantTags | write-task | no (write method: skipped) |  |  |
| audit:getByEntity | override | yes | 200 |  |
| audit:query | override | yes | 200 |  |
| gene-lists:list | read-task | yes | 200 |  |
| gene-lists:create | write-task | no (write method: skipped) |  |  |
| gene-lists:delete | write-task | no (write method: skipped) |  |  |
| gene-lists:getGenes | read-task | yes | 200 |  |
| gene-lists:setGenes | override | no (write method: skipped) |  |  |
| region-files:list | read-task | yes | 200 |  |
| region-files:create | write-task | no (write method: skipped) |  |  |
| region-files:delete | write-task | no (write method: skipped) |  |  |
| region-files:importBed | override | no (write method: skipped) |  |  |
| panels:list | read-task | yes | 200 |  |
| panels:get | override | yes | 200 |  |
| panels:create | write-task | no (write method: skipped) |  |  |
| panels:update | override | no (write method: skipped) |  |  |
| panels:delete | write-task | no (write method: skipped) |  |  |
| panels:duplicate | write-task | no (write method: skipped) |  |  |
| panels:setGenes | write-task | no (write method: skipped) |  |  |
| panels:getGenes | read-task | yes | 200 |  |
| panels:activate | write-task | no (write method: skipped) |  |  |
| panels:deactivate | write-task | no (write method: skipped) |  |  |
| panels:activeForCase | read-task | yes | 200 |  |
| panels:validateSymbols | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| panels:autocomplete | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| panels:searchPanelApp | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| panels:importPanelApp | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| panels:generateStringDb | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| panels:exportBed | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| gene-ref:info | override | yes | 501 | UNKNOWN: geneRef.info is not available in web mode yet. |
| gene-ref:assemblies | override | yes | 501 | UNKNOWN: geneRef.assemblies is not available in web mode yet. |
| gene-ref:checkUpdates | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| gene-ref:update | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| auth:login | override | no (destructive/side-effect: skipped) |  |  |
| auth:logout | override | no (destructive/side-effect: skipped) |  |  |
| auth:currentUser | override | yes | 200 |  |
| auth:isAccountsEnabled | override | yes | 200 |  |
| auth:createUser | override | no (destructive/side-effect: skipped) |  |  |
| auth:listUsers | override | yes | 200 |  |
| auth:deactivateUser | override | no (destructive/side-effect: skipped) |  |  |
| auth:resetPassword | override | no (destructive/side-effect: skipped) |  |  |
| auth:changePassword | override | no (destructive/side-effect: skipped) |  |  |
| analysis-groups:list | read-task | yes | 200 |  |
| analysis-groups:get | read-task | yes | 500 | UNKNOWN: Analysis group 1 not found |
| analysis-groups:create | override | no (write method: skipped) |  |  |
| analysis-groups:update | write-task | no (write method: skipped) |  |  |
| analysis-groups:delete | write-task | no (write method: skipped) |  |  |
| analysis-groups:addMember | override | no (write method: skipped) |  |  |
| analysis-groups:removeMember | write-task | no (write method: skipped) |  |  |
| analysis-groups:getForCase | read-task | yes | 200 |  |
| protein:getMapping | override | yes | 501 | UNKNOWN: protein.getMapping is not available in web mode yet. |
| protein:getDomains | override | yes | 501 | UNKNOWN: protein.getDomains is not available in web mode yet. |
| protein:getStructure | override | yes | 501 | UNKNOWN: protein.getStructure is not available in web mode yet. |
| protein:getGeneStructure | override | yes | 501 | UNKNOWN: protein.getGeneStructure is not available in web mode yet. |
| gnomad:getVariants | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| gnomad:getClinVarVariants | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| perf:getSnapshot | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| perf:resetSnapshot | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| presets:list | read-task | yes | 200 |  |
| presets:create | write-task | no (write method: skipped) |  |  |
| presets:update | write-task | no (write method: skipped) |  |  |
| presets:delete | write-task | no (write method: skipped) |  |  |
| presets:reorder | write-task | no (write method: skipped) |  |  |
| debug:queryCountersGet | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| debug:queryCountersReset | UNKNOWN-404 | no (destructive/side-effect: skipped) |  |  |
| jobs:list | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| jobs:get | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| jobs:progress | UNKNOWN-404 | yes | 404 | NOT_FOUND: unknown method |
| database:health | override(server-only) | yes | 200 |  |
