/**
 * Column-header help, keyed by column key: shown in the header tooltip and as
 * the header's accessible description, for the case and the cohort tables.
 * Each entry names its source; thresholds are stated only where a published
 * one exists. Columns without an entry show just their title.
 */

// CADD PHRED scale: Rentzsch et al., Nucleic Acids Res 2019;47:D886; Kircher et al.,
// Nat Genet 2014. Calibration on CADD v1.6, missense: Pejaver et al., AJHG
// 2022;109:2163, Table 2 (PP3_Supporting 25.3–<28.1, PP3_Moderate ≥ 28.1,
// BP4_Supporting >17.3–22.7, BP4_Moderate ≤ 17.3, no Strong level; one tool only).
const CADD_HELP =
  'CADD PHRED-scaled deleteriousness: −10·log10 of the variant’s rank fraction (rank ÷ all ' +
  'possible SNVs). ≥ 10 = top 10 %, ≥ 20 = top 1 % (common cut-off), ≥ 30 = top 0.1 %. ' +
  'Missense, calibrated on CADD v1.6 (Pejaver 2022): ≥ 25.3 PP3_Supporting, ≥ 28.1 PP3_Moderate, ' +
  '≤ 22.7 BP4_Supporting, ≤ 17.3 BP4_Moderate; no Strong level. Use one tool only. ' +
  'A rank, not a pathogenicity call.'

// Cohort counts are patients, not a population sample, so never ACMG frequency evidence.
const COHORT_CAVEAT =
  ' Patients in this database (relatives included), not a population. Do not use for BA1, BS1 or PM2.'

export const COLUMN_HELP: Readonly<Record<string, string>> = {
  // VCF v4.3 specification (samtools/hts-specs), CHROM/POS/REF/ALT/QUAL/GT.
  chr: 'Chromosome (contig) as named in the imported file, e.g. 1 or chr1.',
  pos: 'Start position (1-based, VCF POS) on the case’s genome build.',
  ref: 'Reference allele (VCF REF).',
  alt: 'Alternate allele (VCF ALT). Multi-allelic sites are split into one row per allele.',
  gt_num:
    'Genotype of the sample (VCF GT): 0/1 heterozygous, 1/1 homozygous alternate; | = phased.',
  qual:
    'VCF QUAL: Phred-scaled confidence that the ALT allele is present; 20 = 99 %, 30 = 99.9 %. ' +
    'Caller-specific, so compare within one caller only.',
  // HGNC symbol as reported by VEP (SYMBOL) or SnpEff (Gene_Name).
  gene_symbol: 'Gene symbol (HGNC) from the variant annotation (VEP or SnpEff).',
  // Ensembl VEP "Calculated variant consequences" (IMPACT column); SnpEff uses similar classes.
  consequence:
    'Impact class of the consequence (VEP; SnpEff uses similar classes): HIGH (e.g. stop_gained, ' +
    'frameshift, splice donor/acceptor ±1–2 bp), ' +
    'MODERATE (e.g. missense, in-frame indel), LOW (e.g. synonymous), MODIFIER (non-coding). ' +
    'A rule-based ranking, not a pathogenicity call.',
  // Sequence Ontology (sequenceontology.org) terms as emitted by VEP / SnpEff.
  func: 'Sequence Ontology consequence term, e.g. missense_variant, stop_gained. Impact is its coarse class.',
  // NCBI ClinVar aggregate germline classification (Landrum et al., NAR 2018).
  clinvar:
    'ClinVar germline classification aggregated across submitters (Pathogenic … Benign, VUS, Conflicting). ' +
    'As of the ClinVar release used for annotation, not live. ' +
    'Check the review status in ClinVar before relying on it.',
  // gnomAD: Karczewski et al., Nature 2020. BA1: Richards et al., Genet Med 2015 (ACMG/AMP)
  // with the ClinGen SVI BA1 rule (Ghosh et al., Hum Mutat 2018: > 5 % in any continental
  // population with ≥ 2,000 alleles, plus an exception list). PM2_Supporting: ClinGen SVI 2020.
  gnomad_af:
    'gnomAD overall allele frequency (AC/AN), exomes or genomes, version as annotated. ' +
    'BA1: AF > 5 % in any continental population with ≥ 2,000 alleles (ClinGen SVI; see its ' +
    'exception list). The overall AF can be lower, so check grpmax. PM2 applies at Supporting ' +
    'strength only (SVI 2020). Empty = no value in the annotation, not proof of absence: check coverage.',
  cadd: CADD_HELP,
  cadd_phred: CADD_HELP,
  // OMIM (omim.org) MIM number supplied by the import file.
  omim_mim_number: 'OMIM MIM number linked to the variant’s gene, from the imported file.',
  // HGVS nomenclature (den Dunnen et al., Hum Mutat 2016; hgvs-nomenclature.org).
  transcript: 'Transcript (Ensembl ENST or RefSeq NM_) the annotation reported for this row.',
  cdna: 'HGVS coding DNA change (c.) on the shown transcript.',
  aa_change: 'HGVS protein change (p.); parentheses = predicted, p.? = effect unknown.',
  // Import-file fields (docs/reference/supported-formats.md: HpoSimScore, MoI).
  hpo_sim_score:
    'Phenotype similarity between the case’s HPO terms and the gene, as supplied by the imported file. ' +
    'Higher = better match; the scale depends on the tool that computed it.',
  moi: 'Mode(s) of inheritance of the gene’s disorders from the imported file, e.g. AD, AR, XLD, XLR.',
  // Cohort-only columns (src/main/database/cohort-frequency-sql.ts).
  carrier_count:
    'Number of imported cases of this genome build that carry the variant (no-calls excluded).' +
    COHORT_CAVEAT,
  cohort_frequency:
    'Carriers ÷ imported cases of this genome build with calls of the same variant type ' +
    '(SNV/indel, SV, CNV or STR): a carrier frequency, not an allele frequency. Cases whose ' +
    'assay does not cover the position count as non-carriers. SV/CNV/STR: exact breakpoints only.' +
    COHORT_CAVEAT,
  het_count:
    'Carriers that are heterozygous / homozygous alternate; + other: hemizygous or no called zygosity.'
}
