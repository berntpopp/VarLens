/** Paths for the shortlist simulation. Large and private data live outside the repository. */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export const DATA_DIR =
  process.env.VARLENS_SIM_DATA_DIR ?? resolve(REPO_ROOT, '../_data/shortlist-sim')
export const PUBLIC_DIR = join(DATA_DIR, 'public')
export const CACHE_DIR = join(DATA_DIR, 'cache')
/** Background-derived intermediates (patient data). Never inside the repository. */
export const PRIVATE_DIR = join(CACHE_DIR, 'private')
export const GENEFOUNDRY_CACHE_DIR = join(CACHE_DIR, 'genefoundry')
export const POOL_FILE = join(DATA_DIR, 'pool', 'pool.json')
export const POOL_NORMALIZED_FILE = join(DATA_DIR, 'pool', 'pool-normalized.json')
export const POOL_LOCAL_VEP_FILE = join(CACHE_DIR, 'pool-local-vep.json')
export const RUNS_DIR = join(DATA_DIR, 'runs')

export const BACKGROUND_DIR =
  process.env.VARLENS_SIM_BACKGROUND_DIR ?? '/run/media/bernt-popp/1819-E513/immunology_cases'

const WORKFLOWS = resolve(REPO_ROOT, '../../varlens-annotation-workflows/resources')
const WORKFLOWS_DIR = process.env.VARLENS_SIM_WORKFLOWS_RESOURCES ?? WORKFLOWS

/** ClinVar 2026-04-26 (copied locally from the annotation workflow; the NAS original is slow). */
export const CLINVAR_VCF = join(PUBLIC_DIR, 'clinvar_20260426.vcf.gz')
export const CLINVAR_ORIGINAL = join(WORKFLOWS_DIR, 'downloads/annotation/clinvar/clinvar.vcf.gz')
export const CLINVAR_2024_VCF = join(PUBLIC_DIR, 'clinvar_20240107.vcf.gz')
export const HPOA_FILE = join(PUBLIC_DIR, 'phenotype.hpoa')

export const VEP_CACHE_DIR = join(WORKFLOWS_DIR, 'prepared/grch38/vep_cache')
/** bgzip FASTA with .fai/.gzi, shipped with the VEP 115 cache. */
export const GRCH38_FASTA = join(
  VEP_CACHE_DIR,
  'homo_sapiens/115_GRCh38/Homo_sapiens.GRCh38.dna.toplevel.fa.gz'
)
export const DBNSFP_FILE = join(WORKFLOWS_DIR, 'downloads/annotation/dbnsfp/dbNSFP5.3.1a_grch38.gz')

const ENV_BIN = join(homedir(), 'miniforge3/envs/varlens-annotate/bin')
export const ANNOTATE_ENV_BIN = process.env.VARLENS_SIM_ENV_BIN ?? ENV_BIN
export const BCFTOOLS = join(ANNOTATE_ENV_BIN, 'bcftools')
export const VEP = join(ANNOTATE_ENV_BIN, 'vep')
export const VEP_PLUGIN_DIR = join(ANNOTATE_ENV_BIN, '../share/ensembl-vep-115.2-1')
