#!/usr/bin/env bash
##############################################################################
# prepare-test-data.sh
#
# Generate VarLens VCF test data from the GIAB Chinese Trio (GRCh38 v4.2.1).
#
# Orchestrates: download -> subset -> merge -> cherry-pick -> annotate
# (VEP + SnpEff in parallel) -> package -> verify.
#
# Usage:
#   ./scripts/prepare-test-data.sh [OPTIONS]
#
# Options:
#   --step STEP        Comma-separated list of steps to run. Available steps:
#                        download, subset, merge, cherry-pick, annotate-vep,
#                        annotate-snpeff, package, verify, all (default: all)
#   --workdir DIR      Working directory for intermediate files
#                        (default: ~/data/varlens-testdata)
#   --outdir DIR       Final output directory for packaged VCFs
#                        (default: tests/test-data/vcf)
#   --region REGION    Genomic region to extract (default: chr22:20000000-21000000)
#   --force            Re-run steps even if output files already exist
#   --cleanup          Remove intermediate files after successful packaging
#   --dry-run          Print what would be done without executing
#   --help             Show this help message
#
# Prerequisites:
#   Run scripts/setup-varlens-tools.sh first to install:
#     - conda environment 'varlens-tools' (bcftools, htslib, snpEff, SnpSift)
#     - Docker image ensemblorg/ensembl-vep:release_115.2
#     - VEP GRCh38 cache (~20 GB) at ~/.vep
#     - ClinVar VCF at ~/data/varlens-testdata/downloads/clinvar.vcf.gz
#
# Data source:
#   GIAB Chinese Trio (GRCh38 v4.2.1)
#   https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio
#   Samples: HG005 (son), HG006 (father), HG007 (mother)
##############################################################################
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SAMPLES=("HG005" "HG006" "HG007")
SAMPLE_NAMES=("HG005_NA24631_son" "HG006_NA24694_father" "HG007_NA24695_mother")
BUILD="GRCh38"
BENCHMARK_VERSION="v4.2.1"
BASE_URL="https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio"
REGION="chr22:29000000-30500000"
CONDA_ENV="varlens-tools"
VEP_IMAGE="ensemblorg/ensembl-vep:release_115.2"
VEP_CACHE_DIR="${HOME}/.vep"
SNPEFF_DB="GRCh38.mane.1.2.ensembl"
CHERRY_PICK_COUNT=5

# Directories (overridable via CLI)
WORKDIR="${HOME}/data/varlens-testdata"
OUTDIR="tests/test-data/vcf"

# CLI flags
STEPS="all"
FORCE=false
CLEANUP=false
DRY_RUN=false

# Derived directories (set after arg parsing)
DOWNLOAD_DIR=""
INTERMEDIATE_DIR=""

# ---------------------------------------------------------------------------
# Logging helpers (timestamped, colored)
# ---------------------------------------------------------------------------
_ts() { date "+%Y-%m-%d %H:%M:%S"; }

log()      { printf "\033[34m[INFO  %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_ok()   { printf "\033[32m[OK    %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_skip() { printf "\033[33m[SKIP  %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_warn() { printf "\033[33m[WARN  %s]\033[0m %s\n" "$(_ts)" "$*"; }
log_err()  { printf "\033[31m[ERROR %s]\033[0m %s\n" "$(_ts)" "$*" >&2; }
log_step() { printf "\n\033[1;35m>>> Step: %s\033[0m\n" "$*"; }

# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

# Check if output file exists and --force is not set; return 0 to skip
should_skip() {
  local file="$1"
  if [[ -f "$file" ]] && ! $FORCE; then
    log_skip "Output exists (use --force to overwrite): $file"
    return 0
  fi
  return 1
}

# Check if a step should run (is in the STEPS list)
should_run_step() {
  local step="$1"
  if [[ "$STEPS" == "all" ]]; then
    return 0
  fi
  # Check if step is in the comma-separated list
  if echo ",$STEPS," | grep -q ",$step,"; then
    return 0
  fi
  return 1
}

# Activate conda environment
activate_conda() {
  log "Activating conda environment '$CONDA_ENV' ..."
  # shellcheck disable=SC1091
  eval "$(conda shell.bash hook)"
  conda activate "$CONDA_ENV"
  log_ok "Conda environment active: $(which bcftools)"
}

# Print command in dry-run mode instead of executing
run_cmd() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
    return 0
  fi
  "$@"
}

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
show_help() {
  sed -n '/^##*$/,/^##*$/{ /^#/s/^# \?//p }' "$0"
  exit 0
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --step)
      STEPS="$2"
      shift 2
      ;;
    --workdir)
      WORKDIR="$2"
      shift 2
      ;;
    --outdir)
      OUTDIR="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --cleanup)
      CLEANUP=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      show_help
      ;;
    *)
      log_err "Unknown option: $1"
      echo "Run with --help for usage."
      exit 1
      ;;
  esac
done

# Set derived directories
DOWNLOAD_DIR="${WORKDIR}/downloads"
INTERMEDIATE_DIR="${WORKDIR}/intermediate"

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
check_prereqs() {
  log_step "Checking prerequisites"

  local ok=true

  # Conda environment
  if conda env list 2>/dev/null | grep -qw "$CONDA_ENV"; then
    log_ok "Conda environment '$CONDA_ENV' exists"
  else
    log_err "Conda environment '$CONDA_ENV' not found. Run scripts/setup-varlens-tools.sh first."
    ok=false
  fi

  # Docker
  if command -v docker &>/dev/null; then
    log_ok "Docker available: $(docker --version)"
  else
    log_warn "Docker not found. VEP annotation step will fail."
  fi

  # VEP image
  if docker image inspect "$VEP_IMAGE" &>/dev/null 2>&1; then
    log_ok "VEP Docker image present: $VEP_IMAGE"
  else
    log_warn "VEP Docker image not pulled: $VEP_IMAGE"
  fi

  # VEP cache
  if [[ -d "${VEP_CACHE_DIR}/homo_sapiens" ]]; then
    log_ok "VEP cache directory exists: ${VEP_CACHE_DIR}/homo_sapiens"
  else
    log_warn "VEP cache directory not found: ${VEP_CACHE_DIR}/homo_sapiens"
  fi

  # ClinVar VCF
  local clinvar_path="${DOWNLOAD_DIR}/clinvar.vcf.gz"
  if [[ -f "$clinvar_path" ]]; then
    log_ok "ClinVar VCF present: $clinvar_path"
  else
    log_warn "ClinVar VCF not found at $clinvar_path. SnpSift ClinVar annotation will be skipped."
  fi

  # Disk space (require ~2 GB free)
  local free_kb
  free_kb=$(df --output=avail "${WORKDIR%/*}" 2>/dev/null | tail -1 || echo "0")
  free_kb="${free_kb// /}"
  if [[ "$free_kb" -gt 2097152 ]]; then
    log_ok "Disk space OK: $(( free_kb / 1024 )) MB free"
  else
    log_warn "Less than 2 GB free disk space on $(dirname "$WORKDIR")"
  fi

  if ! $ok; then
    log_err "Prerequisites check failed. Aborting."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Step: download
# ---------------------------------------------------------------------------
step_download() {
  log_step "Download GIAB benchmark VCFs"

  mkdir -p "$DOWNLOAD_DIR"

  for i in "${!SAMPLES[@]}"; do
    local sample="${SAMPLES[$i]}"
    local name="${SAMPLE_NAMES[$i]}"

    # Construct the FTP URL for each sample
    # URL pattern: .../ChineseTrio/HG005_NA24631_son/NISTv4.2.1/GRCh38/
    #              HG005_GRCh38_1_22_v4.2.1_benchmark.vcf.gz
    local remote_dir="${BASE_URL}/${name}/NIST${BENCHMARK_VERSION}/${BUILD}"
    local vcf_file="${sample}_${BUILD}_1_22_${BENCHMARK_VERSION}_benchmark.vcf.gz"
    local vcf_url="${remote_dir}/${vcf_file}"
    local tbi_url="${remote_dir}/${vcf_file}.tbi"

    local local_vcf="${DOWNLOAD_DIR}/${vcf_file}"
    local local_tbi="${DOWNLOAD_DIR}/${vcf_file}.tbi"

    # Download VCF
    if should_skip "$local_vcf"; then
      continue
    fi
    log "Downloading ${vcf_file} ..."
    run_cmd wget -c -q --show-progress -O "$local_vcf" "$vcf_url"

    # Download index
    if ! should_skip "$local_tbi"; then
      log "Downloading ${vcf_file}.tbi ..."
      run_cmd wget -c -q --show-progress -O "$local_tbi" "$tbi_url"
    fi
  done

  log_ok "Download complete"
}

# ---------------------------------------------------------------------------
# Step: subset
# ---------------------------------------------------------------------------
step_subset() {
  log_step "Subset to chr22"

  mkdir -p "$INTERMEDIATE_DIR"

  for i in "${!SAMPLES[@]}"; do
    local sample="${SAMPLES[$i]}"
    local vcf_file="${sample}_${BUILD}_1_22_${BENCHMARK_VERSION}_benchmark.vcf.gz"
    local input="${DOWNLOAD_DIR}/${vcf_file}"
    local output="${INTERMEDIATE_DIR}/${sample}_chr22.vcf.gz"

    if should_skip "$output"; then
      continue
    fi

    if [[ ! -f "$input" ]] && ! $DRY_RUN; then
      log_err "Input not found: $input (run download step first)"
      return 1
    fi

    log "Subsetting $sample to chr22 ..."
    run_cmd bcftools view -r chr22 "$input" -Oz -o "$output"

    if $DRY_RUN; then continue; fi

    # Check if sample name needs fixing (some GIAB files use different naming)
    local current_name
    current_name=$(bcftools query -l "$output" 2>/dev/null | head -1 || true)
    if [[ -n "$current_name" && "$current_name" != "$sample" ]]; then
      log "Renaming sample '$current_name' -> '$sample' in $output"
      echo "$sample" > "${INTERMEDIATE_DIR}/${sample}_newname.txt"
      run_cmd bcftools reheader -s "${INTERMEDIATE_DIR}/${sample}_newname.txt" \
        -o "${output}.tmp" "$output"
      mv "${output}.tmp" "$output"
      rm -f "${INTERMEDIATE_DIR}/${sample}_newname.txt"
    fi

    log "Indexing ${sample}_chr22.vcf.gz ..."
    run_cmd bcftools index -t "$output"
  done

  log_ok "Subset complete"
}

# ---------------------------------------------------------------------------
# Step: merge
# ---------------------------------------------------------------------------
step_merge() {
  log_step "Merge samples"

  mkdir -p "$INTERMEDIATE_DIR"

  local input_files=()
  for sample in "${SAMPLES[@]}"; do
    input_files+=("${INTERMEDIATE_DIR}/${sample}_chr22.vcf.gz")
  done

  # Verify all inputs exist (skip in dry-run)
  if ! $DRY_RUN; then
    for f in "${input_files[@]}"; do
      if [[ ! -f "$f" ]]; then
        log_err "Input not found: $f (run subset step first)"
        return 1
      fi
    done
  fi

  # Trio full chr22 merge
  local trio_chr22="${INTERMEDIATE_DIR}/trio_chr22.vcf.gz"
  if ! should_skip "$trio_chr22"; then
    log "Merging 3 samples into trio chr22 VCF ..."
    run_cmd bcftools merge "${input_files[@]}" -Oz -o "$trio_chr22"
    run_cmd bcftools index -t "$trio_chr22"
  fi

  # Region subset from trio
  local trio_region="${INTERMEDIATE_DIR}/trio_region.vcf.gz"
  if ! should_skip "$trio_region"; then
    log "Extracting region ${REGION} from trio ..."
    run_cmd bcftools view -r "$REGION" "$trio_chr22" -Oz -o "$trio_region"
    run_cmd bcftools index -t "$trio_region"
  fi

  # Single sample region subset
  local single_sample="${INTERMEDIATE_DIR}/single_sample.vcf.gz"
  if ! should_skip "$single_sample"; then
    log "Extracting single sample (HG005) from region ..."
    run_cmd bcftools view -s HG005 -r "$REGION" "$trio_chr22" \
      --min-ac 1 -Oz -o "$single_sample"
    run_cmd bcftools index -t "$single_sample"
  fi

  log_ok "Merge complete"
}

# ---------------------------------------------------------------------------
# Step: cherry-pick edge cases
# ---------------------------------------------------------------------------
step_cherry_pick() {
  log_step "Cherry-pick edge-case variants"

  local trio_chr22="${INTERMEDIATE_DIR}/trio_chr22.vcf.gz"
  if [[ ! -f "$trio_chr22" ]] && ! $DRY_RUN; then
    log_err "Input not found: $trio_chr22 (run merge step first)"
    return 1
  fi

  local positions_file="${INTERMEDIATE_DIR}/edge_case_positions.txt"
  local output="${INTERMEDIATE_DIR}/edge_cases.vcf.gz"

  if should_skip "$output"; then
    return 0
  fi

  if $DRY_RUN; then
    log "  [dry-run] Would query edge-case variants from $trio_chr22"
    log "  [dry-run] Would extract variants to $output"
    return 0
  fi

  # Collect positions for each edge case category
  log "Finding de novo variants (GT[son]=0/1, GT[father]=0/0, GT[mother]=0/0) ..."
  local denovo_pos="${INTERMEDIATE_DIR}/pos_denovo.txt"
  bcftools query -f '%CHROM\t%POS\n' \
    -i 'GT[0]="0/1" && GT[1]="0/0" && GT[2]="0/0"' \
    "$trio_chr22" | head -n "$CHERRY_PICK_COUNT" > "$denovo_pos" || true
  log "  Found $(wc -l < "$denovo_pos") de novo candidates"

  log "Finding homozygous recessive variants ..."
  local hom_rec_pos="${INTERMEDIATE_DIR}/pos_hom_recessive.txt"
  bcftools query -f '%CHROM\t%POS\n' \
    -i 'GT[0]="1/1" && GT[1]="0/1" && GT[2]="0/1"' \
    "$trio_chr22" | head -n "$CHERRY_PICK_COUNT" > "$hom_rec_pos" || true
  log "  Found $(wc -l < "$hom_rec_pos") hom recessive candidates"

  log "Finding autosomal dominant variants ..."
  local ad_pos="${INTERMEDIATE_DIR}/pos_autosomal_dominant.txt"
  bcftools query -f '%CHROM\t%POS\n' \
    -i 'GT[0]="0/1" && ((GT[1]="0/1" && GT[2]="0/0") || (GT[1]="0/0" && GT[2]="0/1"))' \
    "$trio_chr22" | head -n "$CHERRY_PICK_COUNT" > "$ad_pos" || true
  log "  Found $(wc -l < "$ad_pos") autosomal dominant candidates"

  log "Finding multi-allelic variants ..."
  local multiallelic_pos="${INTERMEDIATE_DIR}/pos_multiallelic.txt"
  bcftools query -f '%CHROM\t%POS\n' \
    -i 'N_ALT>1' \
    "$trio_chr22" | head -n "$CHERRY_PICK_COUNT" > "$multiallelic_pos" || true
  log "  Found $(wc -l < "$multiallelic_pos") multi-allelic candidates"

  log "Finding variants with missing genotypes ..."
  local missing_pos="${INTERMEDIATE_DIR}/pos_missing_gt.txt"
  bcftools query -f '%CHROM\t%POS\n' \
    -i 'GT[0]="mis" || GT[1]="mis" || GT[2]="mis"' \
    "$trio_chr22" | head -n "$CHERRY_PICK_COUNT" > "$missing_pos" || true
  log "  Found $(wc -l < "$missing_pos") missing GT candidates"

  log "Finding indel variants ..."
  local indel_pos="${INTERMEDIATE_DIR}/pos_indels.txt"
  bcftools query -f '%CHROM\t%POS\n' \
    -i 'TYPE="indel"' \
    "$trio_chr22" | head -n "$CHERRY_PICK_COUNT" > "$indel_pos" || true
  log "  Found $(wc -l < "$indel_pos") indel candidates"

  # Combine, deduplicate, and sort all positions
  log "Combining and deduplicating positions ..."
  cat "$denovo_pos" "$hom_rec_pos" "$ad_pos" \
      "$multiallelic_pos" "$missing_pos" "$indel_pos" \
    | sort -k1,1 -k2,2n | uniq > "$positions_file"

  local total
  total=$(wc -l < "$positions_file")
  log "Total unique edge-case positions: $total"

  if [[ "$total" -eq 0 ]]; then
    log_warn "No edge-case positions found, skipping extraction"
    return 0
  fi

  # Extract variants at those positions
  log "Extracting edge-case variants ..."
  run_cmd bcftools view -R "$positions_file" "$trio_chr22" -Oz -o "$output"
  run_cmd bcftools index -t "$output"

  # Clean up temp position files
  rm -f "$denovo_pos" "$hom_rec_pos" "$ad_pos" \
        "$multiallelic_pos" "$missing_pos" "$indel_pos"

  log_ok "Cherry-pick complete: $total unique positions extracted"
}

# ---------------------------------------------------------------------------
# Step: annotate with VEP (Docker)
# ---------------------------------------------------------------------------
step_annotate_vep() {
  log_step "Annotate with VEP (Docker)"

  local input="${INTERMEDIATE_DIR}/trio_region.vcf.gz"
  local output_vcf="${INTERMEDIATE_DIR}/trio_region.vep.vcf"
  local output="${INTERMEDIATE_DIR}/trio_region.vep.vcf.gz"

  if should_skip "$output"; then
    return 0
  fi

  if [[ ! -f "$input" ]] && ! $DRY_RUN; then
    log_err "Input not found: $input (run merge step first)"
    return 1
  fi

  if ! command -v docker &>/dev/null; then
    log_err "Docker is required for VEP annotation but not found"
    return 1
  fi

  # Decompress input for VEP (avoids bgzf issues in some VEP versions)
  local input_plain="${INTERMEDIATE_DIR}/trio_region_for_vep.vcf"
  zcat "$input" > "$input_plain"

  log "Running VEP annotation via Docker (STDOUT mode) ..."
  # Mount input file directly into /opt/vep/ (VEP container has issues with /data mounts)
  # Use STDOUT to avoid container write-permission issues on host volumes
  # Download chr22 FASTA for HGVS notation if not present
  local fasta_dir="${WORKDIR}/downloads"
  local fasta_file="${fasta_dir}/Homo_sapiens.GRCh38.dna.chromosome.22.fa"
  if [[ ! -f "$fasta_file" ]]; then
    log "Downloading GRCh38 chr22 FASTA for HGVS notation..."
    wget -q -P "$fasta_dir" "https://ftp.ensembl.org/pub/release-115/fasta/homo_sapiens/dna/Homo_sapiens.GRCh38.dna.chromosome.22.fa.gz"
    gunzip -f "${fasta_file}.gz"
    samtools faidx "$fasta_file"
  fi

  local fasta_mounts=""
  if [[ -f "$fasta_file" ]]; then
    fasta_mounts="-v ${fasta_file}:/opt/vep/chr22.fa:ro -v ${fasta_file}.fai:/opt/vep/chr22.fa.fai:ro"
  fi

  # shellcheck disable=SC2086
  docker run --rm \
    -v "${input_plain}:/opt/vep/input.vcf:ro" \
    -v "${VEP_CACHE_DIR}:/opt/vep/.vep:ro" \
    ${fasta_mounts} \
    "${VEP_IMAGE}" \
    vep \
      --input_file /opt/vep/input.vcf \
      --output_file STDOUT \
      --vcf --cache --offline \
      --dir_cache /opt/vep/.vep \
      ${fasta_file:+--fasta /opt/vep/chr22.fa} \
      --assembly GRCh38 \
      --everything --pick --hgvs \
      --fork 4 \
      --no_stats \
    2>"${LOG_DIR:-/tmp}/vep_stderr.log" \
    > "$output_vcf"

  rm -f "$input_plain"

  if $DRY_RUN; then
    log_ok "VEP annotation complete (dry-run)"
    return 0
  fi

  if [[ ! -f "$output_vcf" ]]; then
    log_err "VEP output not found: $output_vcf"
    return 1
  fi

  log "Compressing and indexing VEP output ..."
  bgzip -f "$output_vcf"
  tabix -p vcf "$output"

  # Verify CSQ header is present
  if bcftools view -h "$output" | grep -q '##INFO=<ID=CSQ'; then
    log_ok "VEP annotation complete (CSQ header verified)"
  else
    log_warn "VEP output missing CSQ header - annotation may have failed"
  fi
}

# ---------------------------------------------------------------------------
# Step: annotate with SnpEff + SnpSift (conda)
# ---------------------------------------------------------------------------
step_annotate_snpeff() {
  log_step "Annotate with SnpEff + SnpSift (conda)"

  local input="${INTERMEDIATE_DIR}/trio_region.vcf.gz"
  local output="${INTERMEDIATE_DIR}/trio_region.snpeff.vcf.gz"

  if should_skip "$output"; then
    return 0
  fi

  if [[ ! -f "$input" ]] && ! $DRY_RUN; then
    log_err "Input not found: $input (run merge step first)"
    return 1
  fi

  local clinvar_path="${DOWNLOAD_DIR}/clinvar.vcf.gz"
  local raw_output="${INTERMEDIATE_DIR}/trio_region.snpeff.vcf"

  if [[ -f "$clinvar_path" ]]; then
    log "Running SnpEff + SnpSift ClinVar annotation ..."
    run_cmd bash -c "snpEff ann -v -noStats ${SNPEFF_DB} '${input}' \
      | SnpSift annotate -name CLINVAR_ \
          -info CLNSIG,CLNDN,CLNREVSTAT \
          '${clinvar_path}' \
      > '${raw_output}'"
  else
    log_warn "ClinVar VCF not found, running SnpEff only (no SnpSift ClinVar annotation)"
    run_cmd bash -c "snpEff ann -v -noStats ${SNPEFF_DB} '${input}' > '${raw_output}'"
  fi

  if $DRY_RUN; then
    log_ok "SnpEff annotation complete (dry-run)"
    return 0
  fi

  if [[ ! -f "$raw_output" ]]; then
    log_err "SnpEff output not found: $raw_output"
    return 1
  fi

  log "Compressing and indexing SnpEff output ..."
  bgzip -f "$raw_output"
  tabix -p vcf "$output"

  # Verify ANN header is present
  if bcftools view -h "$output" | grep -q '##INFO=<ID=ANN'; then
    log_ok "SnpEff annotation complete (ANN header verified)"
  else
    log_warn "SnpEff output missing ANN header - annotation may have failed"
  fi
}

# ---------------------------------------------------------------------------
# Step: package
# ---------------------------------------------------------------------------
step_package() {
  log_step "Package output files"

  mkdir -p "$OUTDIR"

  # File mapping: intermediate name -> output name
  local -A FILE_MAP=(
    ["trio_region.vcf.gz"]="trio-region.vcf.gz"
    ["trio_region.vcf.gz.tbi"]="trio-region.vcf.gz.tbi"
    ["trio_region.vep.vcf.gz"]="trio-region.vep.vcf.gz"
    ["trio_region.vep.vcf.gz.tbi"]="trio-region.vep.vcf.gz.tbi"
    ["trio_region.snpeff.vcf.gz"]="trio-region.snpeff.vcf.gz"
    ["trio_region.snpeff.vcf.gz.tbi"]="trio-region.snpeff.vcf.gz.tbi"
    ["single_sample.vcf.gz"]="single-sample.vcf.gz"
    ["single_sample.vcf.gz.tbi"]="single-sample.vcf.gz.tbi"
    ["edge_cases.vcf.gz"]="edge-cases.vcf.gz"
    ["edge_cases.vcf.gz.tbi"]="edge-cases.vcf.gz.tbi"
  )

  local copied=0
  for src_name in "${!FILE_MAP[@]}"; do
    local src="${INTERMEDIATE_DIR}/${src_name}"
    local dst="${OUTDIR}/${FILE_MAP[$src_name]}"

    if [[ -f "$src" ]]; then
      log "Copying $src_name -> ${FILE_MAP[$src_name]}"
      run_cmd cp "$src" "$dst"
      (( copied++ )) || true
    else
      log_warn "Intermediate file not found, skipping: $src_name"
    fi
  done

  log "Copied $copied files to $OUTDIR"

  if $DRY_RUN; then
    log "  [dry-run] Would generate PED file and README.md"
    log_ok "Packaging complete (dry-run)"
    return 0
  fi

  # Generate PED file (skip if it already exists unless --force)
  local ped_file="${OUTDIR}/chinese_trio.ped"
  if [[ ! -f "$ped_file" ]] || $FORCE; then
    log "Generating PED file ..."
    cat > "$ped_file" <<'PED'
#Family_ID	Individual_ID	Paternal_ID	Maternal_ID	Sex	Phenotype
CHINESE_TRIO	HG005	HG006	HG007	1	2
CHINESE_TRIO	HG006	0	0	1	1
CHINESE_TRIO	HG007	0	0	2	1
PED
    log_ok "PED file written: $ped_file"
  else
    log_skip "PED file already exists: $ped_file"
  fi

  # Generate README.md with provenance
  local readme_file="${OUTDIR}/README.md"
  log "Generating README.md with provenance info ..."

  local bcftools_ver snpeff_ver
  bcftools_ver=$(bcftools --version 2>/dev/null | head -1 || echo "unknown")
  snpeff_ver=$(snpEff -version 2>&1 | head -1 || echo "unknown")

  {
    echo "# VarLens Test VCF Data"
    echo ""
    echo "Generated by \`scripts/prepare-test-data.sh\` on $(date -Iseconds)."
    echo ""
    echo "## Data Source"
    echo ""
    echo "- **GIAB Chinese Trio** (GRCh38 ${BENCHMARK_VERSION})"
    echo "- Samples: HG005 (son), HG006 (father), HG007 (mother)"
    echo "- Region: \`${REGION}\`"
    echo "- Source URL: <${BASE_URL}>"
    echo ""
    echo "## Tool Versions"
    echo ""
    echo "- bcftools: ${bcftools_ver}"
    echo "- SnpEff: ${snpeff_ver}"
    echo "- VEP Docker: ${VEP_IMAGE}"
    echo ""
    echo "## Files"
    echo ""
    echo "| File | Description | Variants | Size | MD5 |"
    echo "|------|-------------|----------|------|-----|"

    for vcf_out in trio-region.vcf.gz trio-region.vep.vcf.gz trio-region.snpeff.vcf.gz \
                   single-sample.vcf.gz edge-cases.vcf.gz; do
      local fpath="${OUTDIR}/${vcf_out}"
      if [[ -f "$fpath" ]]; then
        local desc=""
        case "$vcf_out" in
          trio-region.vcf.gz)        desc="Trio, region subset" ;;
          trio-region.vep.vcf.gz)    desc="Trio, VEP annotated" ;;
          trio-region.snpeff.vcf.gz) desc="Trio, SnpEff annotated" ;;
          single-sample.vcf.gz)      desc="Single sample (HG005)" ;;
          edge-cases.vcf.gz)         desc="Edge-case variants" ;;
        esac
        local count size md5
        count=$(bcftools view -H "$fpath" 2>/dev/null | wc -l || echo "?")
        size=$(du -h "$fpath" | cut -f1)
        md5=$(md5sum "$fpath" | cut -d' ' -f1)
        echo "| \`${vcf_out}\` | ${desc} | ${count} | ${size} | \`${md5}\` |"
      fi
    done

    echo ""
    echo "## PED File"
    echo ""
    echo "- \`chinese_trio.ped\`: Family structure for trio analysis"
  } > "$readme_file"

  log_ok "README.md written: $readme_file"
  log_ok "Packaging complete"
}

# ---------------------------------------------------------------------------
# Step: verify
# ---------------------------------------------------------------------------
step_verify() {
  log_step "Verify output"

  local expected_files=(
    "trio-region.vcf.gz"
    "trio-region.vcf.gz.tbi"
    "trio-region.vep.vcf.gz"
    "trio-region.vep.vcf.gz.tbi"
    "trio-region.snpeff.vcf.gz"
    "trio-region.snpeff.vcf.gz.tbi"
    "single-sample.vcf.gz"
    "single-sample.vcf.gz.tbi"
    "edge-cases.vcf.gz"
    "edge-cases.vcf.gz.tbi"
    "chinese_trio.ped"
    "README.md"
    "synthetic-unit-test.vcf"
  )

  local missing=0
  local present=0

  echo ""
  printf "  %-35s %s\n" "File" "Status"
  printf "  %-35s %s\n" "---" "------"

  for f in "${expected_files[@]}"; do
    local fpath="${OUTDIR}/${f}"
    if [[ -f "$fpath" ]]; then
      printf "  \033[32m%-35s OK\033[0m\n" "$f"
      (( present++ )) || true
    else
      printf "  \033[31m%-35s MISSING\033[0m\n" "$f"
      (( missing++ )) || true
    fi
  done

  echo ""
  log "Files present: $present / ${#expected_files[@]}"

  # Verify annotation headers
  local vep_file="${OUTDIR}/trio-region.vep.vcf.gz"
  if [[ -f "$vep_file" ]]; then
    if bcftools view -h "$vep_file" | grep -q '##INFO=<ID=CSQ'; then
      log_ok "VEP annotation: CSQ header present"
    else
      log_err "VEP annotation: CSQ header MISSING"
      (( missing++ )) || true
    fi
  fi

  local snpeff_file="${OUTDIR}/trio-region.snpeff.vcf.gz"
  if [[ -f "$snpeff_file" ]]; then
    if bcftools view -h "$snpeff_file" | grep -q '##INFO=<ID=ANN'; then
      log_ok "SnpEff annotation: ANN header present"
    else
      log_err "SnpEff annotation: ANN header MISSING"
      (( missing++ )) || true
    fi
  fi

  # Check sample names in trio VCF match PED
  local trio_file="${OUTDIR}/trio-region.vcf.gz"
  local ped_file="${OUTDIR}/chinese_trio.ped"
  if [[ -f "$trio_file" && -f "$ped_file" ]]; then
    local vcf_samples ped_samples
    vcf_samples=$(bcftools query -l "$trio_file" | sort | tr '\n' ',')
    ped_samples=$(grep -v '^#' "$ped_file" | cut -f2 | sort | tr '\n' ',')
    if [[ "$vcf_samples" == "$ped_samples" ]]; then
      log_ok "Sample names match between VCF and PED"
    else
      log_warn "Sample mismatch - VCF: $vcf_samples PED: $ped_samples"
    fi
  fi

  echo ""
  if [[ "$missing" -eq 0 ]]; then
    log_ok "All verification checks passed"
  else
    log_err "$missing verification issue(s) found"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log "VarLens test data preparation"
  log "  Steps:   $STEPS"
  log "  Workdir: $WORKDIR"
  log "  Outdir:  $OUTDIR"
  log "  Region:  $REGION"
  log "  Force:   $FORCE"
  log "  Dry-run: $DRY_RUN"
  echo ""

  # Create directories
  mkdir -p "$DOWNLOAD_DIR" "$INTERMEDIATE_DIR" "$OUTDIR"

  # Check prerequisites (skip in dry-run)
  if ! $DRY_RUN; then
    check_prereqs
  else
    log_skip "Prerequisite checks (dry-run mode)"
  fi

  # Activate conda (needed for bcftools, snpEff, etc.)
  if ! $DRY_RUN; then
    activate_conda
  fi

  # --- Sequential steps ---
  if should_run_step "download"; then
    step_download
  fi

  if should_run_step "subset"; then
    step_subset
  fi

  if should_run_step "merge"; then
    step_merge
  fi

  if should_run_step "cherry-pick"; then
    step_cherry_pick
  fi

  # --- Parallel annotation steps ---
  local run_vep=false
  local run_snpeff=false

  if should_run_step "annotate-vep"; then
    run_vep=true
  fi
  if should_run_step "annotate-snpeff"; then
    run_snpeff=true
  fi

  if $run_vep && $run_snpeff; then
    log "Running VEP and SnpEff annotations in parallel ..."
    step_annotate_vep &
    local vep_pid=$!
    step_annotate_snpeff &
    local snpeff_pid=$!

    local annotation_failed=false
    if ! wait "$vep_pid"; then
      log_err "VEP annotation failed"
      annotation_failed=true
    fi
    if ! wait "$snpeff_pid"; then
      log_err "SnpEff annotation failed"
      annotation_failed=true
    fi
    if $annotation_failed; then
      log_err "One or more annotation steps failed"
      exit 1
    fi
  elif $run_vep; then
    step_annotate_vep
  elif $run_snpeff; then
    step_annotate_snpeff
  fi

  # --- Post-annotation steps ---
  if should_run_step "package"; then
    step_package
  fi

  if should_run_step "verify"; then
    step_verify
  fi

  # Optional cleanup
  if $CLEANUP; then
    log_step "Cleanup"
    log "Removing intermediate directory: $INTERMEDIATE_DIR"
    run_cmd rm -rf "$INTERMEDIATE_DIR"
    log_ok "Cleanup complete"
  fi

  echo ""
  log_ok "All requested steps completed successfully"
}

main
