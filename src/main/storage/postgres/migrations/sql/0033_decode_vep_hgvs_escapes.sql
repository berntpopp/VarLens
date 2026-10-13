-- #547 (mirrors SQLite v50): rows imported before the fix kept VEP's %3D / %3B
-- escapes in HGVS (`p.Pro814%3D`); decode them like import now does. The
-- generated search_document columns recompute on update.
UPDATE "__schema__"."variants"
   SET cdna = REPLACE(REPLACE(cdna, '%3D', '='), '%3B', ';'),
       aa_change = REPLACE(REPLACE(aa_change, '%3D', '='), '%3B', ';')
 WHERE strpos(cdna, '%3') > 0 OR strpos(aa_change, '%3') > 0;

UPDATE "__schema__"."variant_transcripts"
   SET cdna = REPLACE(REPLACE(cdna, '%3D', '='), '%3B', ';'),
       aa_change = REPLACE(REPLACE(aa_change, '%3D', '='), '%3B', ';')
 WHERE strpos(cdna, '%3') > 0 OR strpos(aa_change, '%3') > 0;

UPDATE "__schema__"."cohort_variant_summary"
   SET cdna = REPLACE(REPLACE(cdna, '%3D', '='), '%3B', ';'),
       aa_change = REPLACE(REPLACE(aa_change, '%3D', '='), '%3B', ';')
 WHERE strpos(cdna, '%3') > 0 OR strpos(aa_change, '%3') > 0;
