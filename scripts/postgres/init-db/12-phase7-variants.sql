-- Phase 9.1: hash-keyed coordinate index requires pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS variants (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  gene_symbol TEXT,
  omim_mim_number TEXT,
  consequence TEXT,
  gnomad_af DOUBLE PRECISION,
  cadd DOUBLE PRECISION,
  clinvar TEXT,
  gt_num TEXT,
  func TEXT,
  qual DOUBLE PRECISION,
  hpo_sim_score DOUBLE PRECISION,
  transcript TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_match TEXT,
  moi TEXT,
  gq DOUBLE PRECISION,
  dp BIGINT,
  ad_ref BIGINT,
  ad_alt BIGINT,
  ab DOUBLE PRECISION,
  filter TEXT,
  info_json TEXT,
  source_format TEXT,
  variant_type TEXT NOT NULL DEFAULT 'snv',
  end_pos BIGINT,
  sv_type TEXT,
  sv_length BIGINT,
  caller TEXT,
  search_document tsvector,
  coord_hash BYTEA GENERATED ALWAYS AS (
    digest(
      int4send(octet_length(chr::bytea)) || chr::bytea ||
      int8send(pos) ||
      int4send(octet_length(ref::bytea)) || ref::bytea ||
      int4send(octet_length(alt::bytea)) || alt::bytea,
      'sha256'
    )
  ) STORED
);

CREATE TABLE IF NOT EXISTS variant_transcripts (
  id BIGSERIAL PRIMARY KEY,
  variant_id BIGINT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  gene_symbol TEXT,
  consequence TEXT,
  func TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_sim_score DOUBLE PRECISION,
  moi TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0,
  is_mane_select INTEGER,
  is_canonical INTEGER,
  UNIQUE(variant_id, transcript_id)
);

CREATE TABLE IF NOT EXISTS variant_frequency (
  id BIGSERIAL PRIMARY KEY,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  case_count BIGINT NOT NULL DEFAULT 1,
  coord_hash BYTEA GENERATED ALWAYS AS (
    digest(
      int4send(octet_length(chr::bytea)) || chr::bytea ||
      int8send(pos) ||
      int4send(octet_length(ref::bytea)) || ref::bytea ||
      int4send(octet_length(alt::bytea)) || alt::bytea,
      'sha256'
    )
  ) STORED
);

CREATE TABLE IF NOT EXISTS variant_sv (
  variant_id BIGINT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  sv_is_precise INTEGER,
  cipos_left BIGINT,
  cipos_right BIGINT,
  ciend_left BIGINT,
  ciend_right BIGINT,
  support BIGINT,
  coverage TEXT,
  strand TEXT,
  stdev_len DOUBLE PRECISION,
  stdev_pos DOUBLE PRECISION,
  vaf DOUBLE PRECISION,
  dr BIGINT,
  dv BIGINT,
  pe_support BIGINT,
  sr_support BIGINT,
  event_id TEXT,
  mate_id TEXT,
  search_document tsvector
);

CREATE TABLE IF NOT EXISTS variant_cnv (
  variant_id BIGINT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  copy_number BIGINT,
  copy_number_quality BIGINT,
  homozygosity_ref DOUBLE PRECISION,
  homozygosity_alt DOUBLE PRECISION,
  sm DOUBLE PRECISION,
  bin_count BIGINT
);

CREATE TABLE IF NOT EXISTS variant_str (
  variant_id BIGINT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  repeat_id TEXT,
  variant_catalog_id TEXT,
  repeat_unit TEXT,
  display_repeat_unit TEXT,
  ref_copies DOUBLE PRECISION,
  alt_copies TEXT,
  repeat_length BIGINT,
  str_status TEXT,
  normal_max BIGINT,
  pathologic_min BIGINT,
  disease TEXT,
  inheritance_mode TEXT,
  source_display TEXT,
  rank_score TEXT,
  locus_coverage DOUBLE PRECISION,
  support_type TEXT,
  confidence_interval TEXT,
  search_document tsvector
);

CREATE OR REPLACE FUNCTION update_variants_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document :=
    to_tsvector('simple',
      concat_ws(' ', NEW.gene_symbol, NEW.consequence, NEW.omim_mim_number, NEW.func, NEW.transcript, NEW.cdna, NEW.aa_change)
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_sv_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := to_tsvector('simple', concat_ws(' ', NEW.event_id, NEW.mate_id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_str_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document :=
    to_tsvector('simple',
      concat_ws(' ', NEW.repeat_id, NEW.variant_catalog_id, NEW.repeat_unit, NEW.display_repeat_unit, NEW.str_status, NEW.disease)
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS variants_search_document_tg ON variants;
CREATE TRIGGER variants_search_document_tg
BEFORE INSERT OR UPDATE ON variants
FOR EACH ROW EXECUTE FUNCTION update_variants_search_document();

DROP TRIGGER IF EXISTS variant_sv_search_document_tg ON variant_sv;
CREATE TRIGGER variant_sv_search_document_tg
BEFORE INSERT OR UPDATE ON variant_sv
FOR EACH ROW EXECUTE FUNCTION update_variant_sv_search_document();

DROP TRIGGER IF EXISTS variant_str_search_document_tg ON variant_str;
CREATE TRIGGER variant_str_search_document_tg
BEFORE INSERT OR UPDATE ON variant_str
FOR EACH ROW EXECUTE FUNCTION update_variant_str_search_document();

CREATE INDEX IF NOT EXISTS idx_variants_case_type ON variants(case_id, variant_type);
CREATE INDEX IF NOT EXISTS idx_variants_case_gene ON variants(case_id, gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_case_pos ON variants(case_id, chr, pos);
CREATE INDEX IF NOT EXISTS idx_variants_case_consequence ON variants(case_id, consequence);
CREATE INDEX IF NOT EXISTS idx_variants_case_func ON variants(case_id, func);
-- Phase 9.1: hash-keyed cross-case coordinate index (replaces idx_variants_coord_case
-- which couldn't store entries for variants with ref+alt > ~2 KB).
CREATE INDEX IF NOT EXISTS idx_variants_coord_hash_case ON variants(coord_hash, case_id);
CREATE UNIQUE INDEX IF NOT EXISTS variant_frequency_coord_hash_uniq
  ON variant_frequency(coord_hash);
CREATE INDEX IF NOT EXISTS idx_variants_search_document ON variants USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_variant_sv_search_document ON variant_sv USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_variant_str_search_document ON variant_str USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_vt_variant_id ON variant_transcripts(variant_id);
CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_cnv_copy_number ON variant_cnv(copy_number);
CREATE INDEX IF NOT EXISTS idx_str_repeat_id ON variant_str(repeat_id);
CREATE INDEX IF NOT EXISTS idx_str_disease ON variant_str(disease);
