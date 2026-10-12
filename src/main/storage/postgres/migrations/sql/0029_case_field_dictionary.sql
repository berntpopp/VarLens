-- Per-case import field dictionary (spec §16, mirrors SQLite v46): JSON text
-- mapping each stored info_json key to its original source field, e.g.
-- {"REVEL":"CSQ:REVEL_score","AltAF_Index":"JSON:AltAF-Index"}. Written by
-- the import; NULL for cases imported before or without kept fields.
-- Replaying this statement changes nothing.
ALTER TABLE "__schema__"."case_data_info" ADD COLUMN IF NOT EXISTS field_dictionary TEXT;
