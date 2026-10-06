#!/usr/bin/env bash
##############################################################################
# setup-varlens-tools.sh
#
# One-time setup script for VarLens bioinformatics tool prerequisites.
# Installs conda environment, Docker images, genome caches, and reference
# data needed by the VarLens test-data preparation pipeline.
#
# Usage:
#   ./scripts/setup-varlens-tools.sh [OPTIONS]
#
# Options:
#   --skip-conda       Skip conda environment creation (bcftools, htslib,
#                      snpeff, snpsift)
#   --skip-docker      Skip Docker image pull (Ensembl VEP)
#   --skip-vep-cache   Skip VEP GRCh38 cache download (~20 GB)
#   --skip-snpeff-db   Skip SnpEff database download
#   --skip-clinvar     Skip ClinVar VCF download
#   --help             Show this help message
#
# Prerequisites:
#   - conda or mamba in PATH
#   - Docker installed and running (unless --skip-docker)
#   - ~25 GB free disk space for caches and databases
#
# The script is idempotent: re-running skips components already installed.
##############################################################################
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CONDA_ENV_NAME="varlens-tools"
VEP_DOCKER_IMAGE="ensemblorg/ensembl-vep:release_115.2"
VEP_CACHE_DIR="${HOME}/.vep"
VEP_RELEASE="115"
VEP_SPECIES="homo_sapiens"
VEP_ASSEMBLY="GRCh38"
SNPEFF_DB="GRCh38.mane.1.2.ensembl"
CLINVAR_DIR="${HOME}/data/varlens-testdata/downloads"
CLINVAR_BASE_URL="https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38"
CLINVAR_VCF="clinvar.vcf.gz"
CLINVAR_TBI="clinvar.vcf.gz.tbi"

# ---------------------------------------------------------------------------
# CLI flags
# ---------------------------------------------------------------------------
SKIP_CONDA=false
SKIP_DOCKER=false
SKIP_VEP_CACHE=false
SKIP_SNPEFF_DB=false
SKIP_CLINVAR=false

# ---------------------------------------------------------------------------
# Logging helpers (timestamped, colored)
# ---------------------------------------------------------------------------
_ts() { date "+%Y-%m-%d %H:%M:%S"; }

log_info()  { printf "\033[34m[INFO  %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_ok()    { printf "\033[32m[OK    %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_skip()  { printf "\033[33m[SKIP  %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_error() { printf "\033[31m[ERROR %s]\033[0m %s\n" "$(_ts)" "$*" >&2; }

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
show_help() {
  # Extract header comments from this script
  sed -n '/^##*$/,/^##*$/{ /^#/s/^# \?//p }' "$0"
  exit 0
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --skip-conda)      SKIP_CONDA=true ;;
    --skip-docker)     SKIP_DOCKER=true ;;
    --skip-vep-cache)  SKIP_VEP_CACHE=true ;;
    --skip-snpeff-db)  SKIP_SNPEFF_DB=true ;;
    --skip-clinvar)    SKIP_CLINVAR=true ;;
    --help|-h)         show_help ;;
    *)
      log_error "Unknown option: $arg"
      echo "Run with --help for usage."
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Track summary status
# ---------------------------------------------------------------------------
declare -A STATUS

# ---------------------------------------------------------------------------
# Step 1: Conda environment
# ---------------------------------------------------------------------------
setup_conda() {
  if $SKIP_CONDA; then
    log_skip "Conda environment (--skip-conda)"
    STATUS[conda]="SKIPPED"
    return
  fi

  # Detect conda or mamba
  local installer=""
  if command -v mamba &>/dev/null; then
    installer="mamba"
  elif command -v conda &>/dev/null; then
    installer="conda"
  else
    log_error "Neither conda nor mamba found in PATH. Install Miniforge/Miniconda first."
    STATUS[conda]="MISSING"
    return
  fi
  log_info "Using $installer to manage conda environment"

  # Check if env already exists
  if conda env list | grep -qw "$CONDA_ENV_NAME"; then
    log_ok "Conda environment '$CONDA_ENV_NAME' already exists"
    STATUS[conda]="OK"
    return
  fi

  log_info "Creating conda environment '$CONDA_ENV_NAME' ..."
  $installer create -y -n "$CONDA_ENV_NAME" \
    -c bioconda -c conda-forge -c defaults \
    bcftools htslib snpsift snpeff

  log_ok "Conda environment '$CONDA_ENV_NAME' created"
  STATUS[conda]="OK"
}

# ---------------------------------------------------------------------------
# Step 2: Docker VEP image
# ---------------------------------------------------------------------------
setup_docker_vep() {
  if $SKIP_DOCKER; then
    log_skip "Docker VEP image (--skip-docker)"
    STATUS[docker_vep]="SKIPPED"
    return
  fi

  if ! command -v docker &>/dev/null; then
    log_error "Docker not found in PATH"
    STATUS[docker_vep]="MISSING"
    return
  fi

  # Check if image already exists
  if docker image inspect "$VEP_DOCKER_IMAGE" &>/dev/null; then
    log_ok "Docker image '$VEP_DOCKER_IMAGE' already present"
    STATUS[docker_vep]="OK"
    return
  fi

  log_info "Pulling Docker image '$VEP_DOCKER_IMAGE' ..."
  docker pull "$VEP_DOCKER_IMAGE"
  log_ok "Docker image '$VEP_DOCKER_IMAGE' pulled"
  STATUS[docker_vep]="OK"
}

# ---------------------------------------------------------------------------
# Step 3: VEP GRCh38 cache
# ---------------------------------------------------------------------------
setup_vep_cache() {
  if $SKIP_VEP_CACHE; then
    log_skip "VEP cache (--skip-vep-cache)"
    STATUS[vep_cache]="SKIPPED"
    return
  fi

  local cache_subdir="${VEP_CACHE_DIR}/${VEP_SPECIES}/${VEP_RELEASE}_${VEP_ASSEMBLY}"

  if [[ -d "$cache_subdir" ]]; then
    log_ok "VEP cache already present at $cache_subdir"
    STATUS[vep_cache]="OK"
    return
  fi

  if ! command -v docker &>/dev/null; then
    log_error "Docker required to install VEP cache but not found"
    STATUS[vep_cache]="MISSING"
    return
  fi

  mkdir -p "$VEP_CACHE_DIR"

  local cache_tarball="${VEP_SPECIES}_vep_${VEP_RELEASE}_${VEP_ASSEMBLY}.tar.gz"
  local cache_url="https://ftp.ensembl.org/pub/release-${VEP_RELEASE}/variation/indexed_vep_cache/${cache_tarball}"

  log_info "Downloading VEP ${VEP_ASSEMBLY} cache (release ${VEP_RELEASE}) — this may take a while (~20 GB) ..."
  wget -c -q --show-progress -P "$VEP_CACHE_DIR" "$cache_url"

  log_info "Extracting VEP cache (this also takes a while) ..."
  tar xzf "${VEP_CACHE_DIR}/${cache_tarball}" -C "$VEP_CACHE_DIR"
  rm -f "${VEP_CACHE_DIR}/${cache_tarball}"

  if [[ -d "$cache_subdir" ]]; then
    log_ok "VEP cache installed at $cache_subdir"
    STATUS[vep_cache]="OK"
  else
    log_error "VEP cache directory not found after install: $cache_subdir"
    STATUS[vep_cache]="MISSING"
  fi
}

# ---------------------------------------------------------------------------
# Step 4: SnpEff database
# ---------------------------------------------------------------------------
setup_snpeff_db() {
  if $SKIP_SNPEFF_DB; then
    log_skip "SnpEff database (--skip-snpeff-db)"
    STATUS[snpeff_db]="SKIPPED"
    return
  fi

  if $SKIP_CONDA; then
    log_skip "SnpEff database (conda skipped, snpEff unavailable)"
    STATUS[snpeff_db]="SKIPPED"
    return
  fi

  # Confirm snpEff is available before querying or downloading its database.
  if ! conda run -n "$CONDA_ENV_NAME" which snpEff &>/dev/null; then
    log_error "snpEff not found in conda environment '$CONDA_ENV_NAME'"
    STATUS[snpeff_db]="MISSING"
    return
  fi

  # Check if database already exists by trying a quick snpEff dump
  if conda run -n "$CONDA_ENV_NAME" snpEff dump "$SNPEFF_DB" &>/dev/null; then
    log_ok "SnpEff database '${SNPEFF_DB}' already present"
    STATUS[snpeff_db]="OK"
    return
  fi

  log_info "Downloading SnpEff database '${SNPEFF_DB}' ..."
  conda run -n "$CONDA_ENV_NAME" snpEff download "$SNPEFF_DB"

  if conda run -n "$CONDA_ENV_NAME" snpEff dump "$SNPEFF_DB" &>/dev/null; then
    log_ok "SnpEff database '${SNPEFF_DB}' downloaded"
    STATUS[snpeff_db]="OK"
  else
    log_error "SnpEff database '${SNPEFF_DB}' download may have failed — verify manually"
    STATUS[snpeff_db]="MISSING"
  fi
}

# ---------------------------------------------------------------------------
# Step 5: ClinVar VCF
# ---------------------------------------------------------------------------
setup_clinvar() {
  if $SKIP_CLINVAR; then
    log_skip "ClinVar VCF (--skip-clinvar)"
    STATUS[clinvar]="SKIPPED"
    return
  fi

  mkdir -p "$CLINVAR_DIR"

  local vcf_path="${CLINVAR_DIR}/${CLINVAR_VCF}"
  local tbi_path="${CLINVAR_DIR}/${CLINVAR_TBI}"

  if [[ -f "$vcf_path" && -f "$tbi_path" ]]; then
    log_ok "ClinVar VCF already present at $vcf_path"
    STATUS[clinvar]="OK"
    return
  fi

  log_info "Downloading ClinVar GRCh38 VCF ..."
  curl -fSL -o "$vcf_path" "${CLINVAR_BASE_URL}/${CLINVAR_VCF}"
  log_info "Downloading ClinVar GRCh38 VCF index ..."
  curl -fSL -o "$tbi_path" "${CLINVAR_BASE_URL}/${CLINVAR_TBI}"

  if [[ -f "$vcf_path" && -f "$tbi_path" ]]; then
    log_ok "ClinVar VCF downloaded to $CLINVAR_DIR"
    STATUS[clinvar]="OK"
  else
    log_error "ClinVar download failed"
    STATUS[clinvar]="MISSING"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
  echo ""
  echo "============================================"
  echo " VarLens Tools Setup Summary"
  echo "============================================"

  local components=("conda" "docker_vep" "vep_cache" "snpeff_db" "clinvar")
  local labels=("Conda env ($CONDA_ENV_NAME)" "Docker VEP image" "VEP GRCh38 cache" "SnpEff database" "ClinVar VCF")

  for i in "${!components[@]}"; do
    local key="${components[$i]}"
    local label="${labels[$i]}"
    local state="${STATUS[$key]:-UNKNOWN}"

    case "$state" in
      OK)      printf "  \033[32m✔ OK\033[0m      %s\n" "$label" ;;
      SKIPPED) printf "  \033[33m⊘ SKIP\033[0m    %s\n" "$label" ;;
      MISSING) printf "  \033[31m✘ MISSING\033[0m  %s\n" "$label" ;;
      *)       printf "  \033[31m? UNKNOWN\033[0m  %s\n" "$label" ;;
    esac
  done

  echo "============================================"
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log_info "Starting VarLens tools setup ..."
echo ""

setup_conda
setup_docker_vep
setup_vep_cache
setup_snpeff_db
setup_clinvar

print_summary

log_info "Setup complete."
