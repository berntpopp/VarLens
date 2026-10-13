-- Built-in filter presets named by the clinical question they answer, each
-- with a one-line description (#570; mirrors SQLite v53).
--
-- A schema created by this version already has the new names from the 0005
-- seed (seedWorkflowDefaults reads BUILT_IN_PRESETS); an existing one is
-- renamed here. The values repeat BUILT_IN_PRESET_RENAMES_V53 and the
-- descriptions on purpose: a migration is a fixed record.
-- tests/main/storage/postgres-migration-definitions.test.ts fails if they differ.
--
-- Only built-in rows are renamed. A built-in keeps its old name when a user
-- preset already has the new one, so the unique name never collides.
-- Visibility and every user preset stay as they are. Replaying changes nothing.
UPDATE "__schema__"."filter_presets" AS p
   SET name = r.new_name,
       description = r.description,
       updated_at = (extract(epoch from now()) * 1000)::bigint
  FROM (VALUES
    ('Rare Pathogenic', 'Rare known pathogenic', 'Rare (gnomAD AF <= 1%) and ClinVar pathogenic or likely pathogenic'),
    ('Rare HIGH', 'Rare loss-of-function', 'Rare (gnomAD AF <= 1%) and HIGH impact: stop, frameshift, splice site'),
    ('Rare HIGH+MOD', 'Rare protein-altering', 'Rare (gnomAD AF <= 1%) and HIGH or MODERATE impact, missense included'),
    ('Ultra Rare HIGH', 'Ultra-rare loss-of-function', 'Almost absent from gnomAD (AF <= 0.001%) and HIGH impact'),
    ('ClinVar P/LP', 'Known pathogenic', 'ClinVar pathogenic or likely pathogenic, at any frequency'),
    ('HIGH Impact', 'Loss-of-function', 'HIGH impact (stop, frameshift, splice site), at any frequency'),
    ('Rare (1%)', 'Rare in population', 'gnomAD AF <= 1%, or not in gnomAD'),
    ('CADD >= 20', 'Predicted deleterious', 'CADD Phred score at least 20 (top 1% most deleterious)')
  ) AS r(old_name, new_name, description)
 WHERE p.name = r.old_name
   AND p.is_built_in = 1
   AND NOT EXISTS (
     SELECT 1 FROM "__schema__"."filter_presets" AS taken WHERE taken.name = r.new_name
   );
