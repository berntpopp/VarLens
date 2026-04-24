INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
VALUES
  (1, 'Oldest Case', '/data/oldest.vcf.gz', 1024, 0, 1714060800000, 'GRCh38'),
  (2, 'Middle Case', '/data/middle.vcf.gz', 2048, 21, 1714060801000, 'GRCh37'),
  (3, 'Newest Case', '/data/newest.vcf.gz', 4096, 42, 1714060802000, 'GRCh38');
