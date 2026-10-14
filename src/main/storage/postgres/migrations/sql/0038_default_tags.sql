-- The default quick-flag tags (#125; mirrors SQLite v55).
--
-- The values repeat DEFAULT_TAGS (shared/config/default-tags.config.ts) on
-- purpose: a migration is a fixed record.
-- tests/main/storage/postgres-migration-definitions.test.ts fails if they differ.
--
-- A name a user already has, in any letter case, is skipped; user tags are
-- never changed. Replaying changes nothing.
INSERT INTO "__schema__"."tags" (name, color, created_at)
SELECT d.name, d.color, (extract(epoch from now()) * 1000)::bigint
  FROM (VALUES
    ('Pathogenic candidate', '#F44336', 1),
    ('VUS follow-up', '#FFC107', 2),
    ('Benign/artifact', '#4CAF50', 3),
    ('Reported', '#2196F3', 4)
  ) AS d(name, color, ord)
 WHERE NOT EXISTS (
   SELECT 1 FROM "__schema__"."tags" AS t WHERE lower(t.name) = lower(d.name)
 )
 ORDER BY d.ord;
