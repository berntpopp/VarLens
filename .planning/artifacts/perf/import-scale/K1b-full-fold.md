# K1b: the rest of the fold, step by step (synthetic, rolled back)

Same synthetic spectrum and method as `K1-fold-scaling.md` (234,783 shared sites at allele
frequency 0.01–0.45, 6,000 private sites per sample; each fold in a transaction that is
rolled back; WAL from `pg_current_wal_insert_lsn()`). One run per cell, plus a second pass;
host load 6.5–8.5, 26–28 GB available. Everything here was run, except where a line says
"derived".

Tables, at 1,000 samples (6.2 M sites) / 10,000 samples (60 M sites):

| Table | Content | Size |
|---|---|---|
| `site_stats` | site id, carrier/het/hom, primary key + carrier keyset index | 632 MB / 6.1 GB |
| `site_repr` | representative annotation per site (gene, impact, func, ClinVar, gnomAD, CADD, transcript), primary key + 3 filter indexes | 1.15 GB / 11 GB |
| `coord_freq` | second narrow counter, stands for `variant_frequency` | 397 MB / 3.8 GB |
| `gene_stats` | 35,000 genes: variant rows, unique variants, affected cases | 3 MB |
| `cohort_counter` | unique-variant counter, one row | – |

Per case, prepared before the fold (not timed): the aggregated site delta and the per-gene
row and case counts. Steps timed inside the fold: (1) counter upsert returning which sites
are new; (2) representative rows inserted **for new sites only**; (3) gene counters summed
from the prepared per-gene counts plus new unique sites; (4) the second counter table;
(5) the unique-variant counter.

## (a) How many representative rows a case writes (measured on imported data)

Legacy schema with 20 simulated exomes and the GIAB trio (VEP), current `main`:

| Case added | Sites in the case | New sites | Known sites whose representative value rises |
|---|---|---|---|
| Simulated case 2 after 1 | 59,998 | 43,741 | 3 |
| Simulated case 10 after 9 | 59,996 | 10,818 | 4 |
| Simulated case 20 after 19 | 59,998 | 7,542 | 13 |
| GIAB HG006 after HG005 | 1,793 | 407 | 0 |
| GIAB HG007 after HG005 + HG006 | 1,809 | 355 | 0 |

As expected: almost none once a site is known. The 3–13 are the simulator's duplicate
coordinates with different CADD values. On real VEP output the same site gets the same
annotation in every sample of one pipeline run, so the number should stay near zero; it
would rise when samples annotated with different VEP or database versions are mixed,
which neither data set contains.

## Full fold T(K), second (warm) pass

Cells are ms / WAL MB.

**6.2 M sites**

| K | Counters | Representative (rows) | Gene counters | Second counter | Full fold ms | Per case ms | WAL MB |
|---|---|---|---|---|---|---|---|
| 1 | 283 / 20 | 79 / 4 (6,000) | 139 / 8 | 197 / 15 | 699 | 699 | 47 |
| 4 | 738 / 53 | 318 / 13 (24,000) | 159 / 10 | 460 / 40 | 1,676 | 419 | 116 |
| 8 | 1,008 / 74 | 579 / 25 (48,000) | 160 / 10 | 625 / 55 | 2,373 | 297 | 164 |
| 16 | 1,310 / 97 | 1,076 / 48 (96,000) | 156 / 10 | 765 / 70 | 3,310 | 207 | 225 |
| 32 | 1,751 / 127 | 2,254 / 91 (192,000) | 195 / 10 | 1,020 / 91 | 5,225 | 163 | 319 |

**60 M sites**

| K | Counters | Representative (rows) | Gene counters | Second counter | Full fold ms | Per case ms | WAL MB |
|---|---|---|---|---|---|---|---|
| 1 | 314 / 20 | 78 / 2 (6,000) | 156 / 8 | 218 / 15 | 766 | 766 | 46 |
| 4 | 816 / 54 | 316 / 9 (24,000) | 154 / 10 | 520 / 40 | 1,806 | 452 | 112 |
| 8 | 1,176 / 74 | 602 / 19 (48,000) | 150 / 10 | 712 / 55 | 2,641 | 330 | 157 |
| 16 | 1,660 / 96 | 1,258 / 37 (96,000) | 162 / 10 | 869 / 70 | 3,953 | 247 | 213 |
| 32 | 1,956 / 127 | 2,355 / 75 (192,000) | 177 / 10 | 1,075 / 91 | 5,568 | 174 | 303 |

The unique-variant counter costs 0–5 ms. Counters cost more here than in K1 because the
statement also returns which sites it inserted.

**First pass at 60 M sites, directly after the build** (index pages of the 11 GB
representative table not yet in shared buffers): the representative step took 2,571 ms at
K = 1 and 8,115 ms at K = 32 (WAL 104 and 452 MB), the full fold 3,458 and 11,425 ms. The
warm figures above are the favourable case; inserting 6,000 scattered rows per case into
three secondary indexes of a table that does not fit in memory is the expensive part of
a fold when it is cold.

A first version aggregated the gene counts from the calls inside the fold; that step then
grew linearly (195 ms at K = 1, 3,149–3,581 ms at K = 32 at 6.2 M sites). Preparing them
per case outside the fold makes it flat at about 150–200 ms.

## Not measured

- (c) flags as per-site reference counts: no synthetic annotations were created;
- (f) column metadata outside the fold: only today's in-publication figure exists,
  173–456 ms per case (`pub-column-meta`), no lazy recompute was built;
- any of this on the GIAB/VEP spectrum beyond table (a);
- the sustained-arrival run (K1c).

## Control: today's publication step

Same host, current `main`, legacy schema, simulated samples 16–20 of a sequential import
(median, `VARLENS_PG_IMPORT_PROFILE=1`): summary upsert 1,714 ms, variant frequency 503 ms,
prepare (outside the lock) 304 ms, column metadata 187 ms. That is 2.2 s under the lock
per case at 20 samples; earlier runs on this branch's base measured 3.9 s for the summary
upsert alone at samples 81–100. The control was not run on a 6 M or 60 M-site schema and
not alternating with the fold.

## Arrival rates (derived from the warm T(K) above, not run)

Capacity of one folder is K / T(K): 1.3 cases/s at K = 1, 2.2 at 4, 3.0 at 8, 4.0 at 16,
5.7 at 32 (60 M sites).

| Rate | K needed | T(K) | Queue age (fold in progress + own fold) | Gate ≤ 2 s |
|---|---|---|---|---|
| 1 case/s | 1 | 0.77 s | up to about 1.5 s | holds |
| 2.5 cases/s | 8 | 2.6 s | above 2.6 s | fails |
| 5 cases/s | 32 | 5.6 s | above 5.6 s | fails |

Without the second counter table (frequency served from `site_stats`): 0.55 s at K = 1,
1.29 s at K = 4 (3.1 cases/s), 1.93 s at K = 8; 2.5 cases/s still gives an age above 2 s.

## Verdict against the gate (T(K) ≤ 1 s at the K the arrival rate needs, queue age ≤ 2 s)

- **1 case/s: PASS** on the measured T(1) of 0.70–0.77 s warm. A single-case fold is about
  a third of today's 2.2 s under the lock.
- **2.5 and 5 cases/s: KILL** as designed here, derived from measured T(K): the fold stops
  saturating because new private sites (6,000 per case in this spectrum) and the second
  counter grow with K, so T(K) exceeds 2 s before K reaches the size the rate needs.
- The cold first pass (3.5 s at K = 1) fails the gate even at 1 case/s.

What would have to change for the higher rates: representative rows for brand-new sites
written by the importers before the fold (they are not shared, so they need no
serialisation), frequency served from the one counter table, and no `RETURNING` on the
counter upsert. None of that was measured.
