-- 0015_public_annotation_schema.sql
--
-- Public annotation DB schema. This migration is NOT part of the main
-- POSTGRES_MIGRATIONS set (which runs against workspace/control DBs); it belongs
-- to PUBLIC_ANNOTATION_MIGRATIONS and is applied only against the dedicated public
-- annotation database by the `sync-public-annotations` command, replacing the ad-hoc
-- CREATE TABLE IF NOT EXISTS DDL that previously ran inside each sync transaction.

CREATE TABLE IF NOT EXISTS public_annotation_snapshots (
  snapshot_id text PRIMARY KEY,
  schema_version text NOT NULL,
  bundle_id text,
  genome_build text,
  mapping_version text NOT NULL,
  content_hash text NOT NULL,
  manifest_checksum text NOT NULL,
  license_matrix_checksum text NOT NULL,
  source_manifest_checksum text NOT NULL,
  private_case_data boolean NOT NULL DEFAULT false,
  stored_manifest_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_annotation_files (
  snapshot_id text NOT NULL REFERENCES public_annotation_snapshots(snapshot_id) ON DELETE CASCADE,
  role text NOT NULL,
  path text NOT NULL,
  checksum text,
  size_bytes bigint,
  index_path text,
  index_checksum text,
  index_size_bytes bigint,
  required boolean NOT NULL DEFAULT true,
  format_version text,
  PRIMARY KEY (snapshot_id, role, path)
);

CREATE TABLE IF NOT EXISTS public_annotation_sync_events (
  event_id bigserial PRIMARY KEY,
  snapshot_id text NOT NULL REFERENCES public_annotation_snapshots(snapshot_id) ON DELETE CASCADE,
  source_manifest_checksum text NOT NULL,
  public_file_count integer NOT NULL,
  private_case_data boolean NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_annotation_variant_records (
  snapshot_id text NOT NULL REFERENCES public_annotation_snapshots(snapshot_id) ON DELETE CASCADE,
  chr text NOT NULL,
  pos bigint NOT NULL,
  ref text NOT NULL,
  alt text NOT NULL,
  source_id text NOT NULL,
  field_name text NOT NULL,
  field_value jsonb NOT NULL,
  evidence_json jsonb NOT NULL,
  provenance_json jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, chr, pos, ref, alt, source_id, field_name)
);

CREATE INDEX IF NOT EXISTS public_annotation_variant_records_lookup_idx
  ON public_annotation_variant_records (chr, pos, ref, alt);
