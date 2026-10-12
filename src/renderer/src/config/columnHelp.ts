/**
 * Column-header help, keyed by column key: shown in the header tooltip and as
 * the header's accessible description, for the case and the cohort tables.
 * Each entry names its source; thresholds are stated only where a published
 * one exists. Columns without an entry show just their title.
 */

// CADD v1.6+ PHRED scale: Rentzsch et al., Nucleic Acids Res 2019;47:D886 (and
// Kircher et al., Nat Genet 2014). PP3 cut-off: Pejaver et al., AJHG 2022;109:2163
// (ClinGen SVI calibration, missense).
const CADD_HELP =
  'CADD PHRED-scaled deleteriousness: −10·log10 of the variant’s rank among all possible SNVs. ' +
  '≥ 10 = top 10 %, ≥ 20 = top 1 % (common cut-off), ≥ 30 = top 0.1 %. ' +
  'For missense, ≥ 25.3 supports PP3 (ClinGen calibration). A rank, not a pathogenicity call.'

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
  // Ensembl VEP "Calculated variant consequences" (IMPACT column); SnpEff uses the same classes.
  consequence:
    'Impact class of the consequence (VEP/SnpEff): HIGH (e.g. stop_gained, frameshift, splice site), ' +
    'MODERATE (e.g. missense, in-frame indel), LOW (e.g. synonymous), MODIFIER (non-coding). ' +
    'A rule-based ranking, not a pathogenicity call.',
  // Sequence Ontology (sequenceontology.org) terms as emitted by VEP / SnpEff.
  func: 'Sequence Ontology consequence term, e.g. missense_variant, stop_gained. Impact is its coarse class.',
  // NCBI ClinVar aggregate germline classification (Landrum et al., NAR 2018).
  clinvar:
    'ClinVar germline classification aggregated across submitters (Pathogenic … Benign, VUS, Conflicting). ' +
    'Check the review status in ClinVar before relying on it.',
  // gnomAD: Karczewski et al., Nature 2020. BA1/PM2:
  // Richards et al., Genet Med 2015 (ACMG/AMP); PM2 at supporting strength per ClinGen SVI 2020.
  gnomad_af:
    'gnomAD allele frequency (alt alleles / all alleles); the version is that of the annotation. ' +
    'ACMG/AMP: > 0.05 (5 %) = BA1 stand-alone benign; PM2 needs absent or extremely rare. ' +
    'Empty = no gnomAD value in the annotation.',
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
  carrier_count: 'Number of imported cases of this genome build that carry the variant.',
  cohort_frequency:
    'Carriers ÷ imported cases of this genome build: a carrier frequency within this database, ' +
    'not an allele frequency.',
  het_count: 'Carriers that are heterozygous / homozygous alternate.'
}
