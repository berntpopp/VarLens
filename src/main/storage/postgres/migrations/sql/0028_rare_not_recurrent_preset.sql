-- Built-in filter preset "Rare, not recurrent" (#455): gnomAD AF <= 1% and
-- seen in at most 3 cases of this database, the open case included
-- (mirrors SQLite v45).
--
-- A schema created by this version already has the row from the 0005 seed
-- (seedWorkflowDefaults reads BUILT_IN_PRESETS); an existing schema gets it
-- here. The values repeat that definition on purpose: a migration is a fixed
-- record. tests/main/storage/postgres-migration-definitions.test.ts fails if
-- the two differ.
--
-- ON CONFLICT DO NOTHING: every existing row, and a user preset of the same
-- name, stays as it is. Replaying this statement changes nothing.
INSERT INTO "__schema__"."filter_presets"
  (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
VALUES (
  'Rare, not recurrent',
  'gnomAD AF <= 1% + seen in at most 3 cases',
  '{"maxGnomadAf":0.01,"maxCarriers":3}',
  1, 1, 8, 'filter',
  (extract(epoch from now()) * 1000)::bigint,
  (extract(epoch from now()) * 1000)::bigint
)
ON CONFLICT (name) DO NOTHING;
