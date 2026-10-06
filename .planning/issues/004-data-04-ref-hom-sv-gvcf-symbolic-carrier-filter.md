---
id: "DATA-04"
number: 4
title: "Ref-homozygous 0/0 structural variants and gVCF <NON_REF>/<*> symbolic alleles imported as false carriers"
priority: "P1 - Critical"
tags: ["data-integrity", "vcf", "sv", "clinical-safety", "bug"]
affected_files:
  - "src/main/import/vcf/VcfMapper.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [DATA-04] Ref-homozygous 0/0 structural variants and gVCF <NON_REF>/<*> symbolic alleles imported as false carriers

| Attribute | Value |
|---|---|
| **Priority** | **P1 - Critical** |
| **Tags** | `data-integrity` `vcf` `sv` `clinical-safety` `bug` |
| **Affected Files** | `src/main/import/vcf/VcfMapper.ts` |
| **Audited Snippet** | `In VcfMapper.ts:57-65, isStructural is true for <DEL>, <NON_REF>, etc. The filter 'if (isStructural ...` |

---

## Technical Context & Audited Impact
Cases are populated with thousands of false SVs they do not carry.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# DATA-04 review: 0/0 structural variants and gVCF `<NON_REF>`/`<*>` alleles imported as false carriers

## 1. Validated technical assessment

**The finding is valid for the code on `main` (HEAD `8a662b89`).** The committed `src/main/import/vcf/VcfMapper.ts:57-65` reads:

```ts
const isStructural = rawAlt.startsWith('<') || rawAlt.includes('[') || rawAlt.includes(']') || record.info.has('SVTYPE')
if (isStructural || carriedAlleles.has(altIdx + 1)) targetAltIndexes.push(altIdx)
```

**Root cause:** for structural records, this check skips the genotype test entirely. Anything with a symbolic ALT, a breakend ALT, or `INFO/SVTYPE` is imported for every selected sample, whatever its `GT` is. The comment on `mapVcfRecord` says the function returns nothing for 0/0 or ./., but that is not what this code does. Three things go wrong:

- **0/0 SV carriers.** In a multi-sample SV VCF, every sample with `0/0` or `0|0` gets the SV. Because a multi-sample import creates one case per sample, every case gets the whole cohort's SV set.
- **Sequence-resolved SVs.** An insertion with a literal ALT plus `SVTYPE=INS` counts as structural only because of the INFO tag, so it hits the same bug.
- **gVCF reference blocks.** `<NON_REF>` (GATK, DRAGEN) and `<*>` (bcftools, DeepVariant) start with `<`, so every reference block is treated as an SV. A WGS gVCF has roughly 10⁷ blocks. The import inflates massively, and nearly every one of those rows is a false SV.

**Blast radius:** all four import paths call this same function: `workers/import-pipeline.ts`, `ipc/handlers/import-logic-append.ts`, `import/vcf/VcfStrategy.ts` and `workers/postgres-vcf-stream.ts`. So SQLite, Postgres and append imports are all affected, and so is everything downstream that reads the stored rows (cohort counts, SV filters, exports).

**Partial fix already in the working tree.** Your uncommitted changes on `feat/variant-simulator` (`VcfMapper.ts` plus 3 new tests in `vcf-mapper.test.ts`) already:
- skip `<NON_REF>` and `<*>`;
- check carrier status for every allele when a GT is called;
- import SVs with a missing GT only when the GT is completely absent (`.`, `./.`, `.|.`).

That covers the main cases. Some gaps remain:

| # | Edge case | Status in working tree |
|---|---|---|
| a | **Merged multi-sample SV VCFs** (Jasmine, SURVIVOR, truvari, Sniffles2 multi-sample) write `./.` for samples that don't support the call | ❌ Still false carriers. Every uncalled sample gets the SV. |
| b | `FORMAT` has no `GT` key at all (sites-only or non-genotyping caller) | Imported, because it falls back to `'.'`. That's acceptable, but it isn't distinguished from a called `./.`. |
| c | Polyploid or other all-missing forms (`./././.`, `.|./.`) | Not recognised as no-call, so they're dropped. Safe, but inconsistent with (a). |
| d | Partial no-call `./1` | Imported as a carrier. Correct. |
| e | Uppercase `<NON_REF>` and exact `<*>` are checked separately | The check is redundant and has two separate code paths for one rule. |
| f | Header comment on `mapVcfRecord` | Still says ./. returns nothing, which is now wrong for SVs. |

I could not run `vitest` here because the command wasn't approved, so the working-tree tests are **not verified**.

## 2. Severity and priority

**P1 (Critical).** This corrupts clinical data silently: patients are shown as carrying deletions or duplications they don't have, with no error or warning. A gVCF import can also blow up the database by orders of magnitude. It isn't P0 because the common single-sample SNV/indel VCF path is unaffected, and the bug only triggers with SV, multi-sample or gVCF inputs.

## 3. Labels

`bug`, `data-integrity`, `vcf-import`, `structural-variants`, `clinical-safety`, `parity` (SQLite and Postgres paths)

## 4. Issue specification

**Title:** `fix(import): VcfMapper imports SVs for 0/0 and uncalled samples and treats gVCF <NON_REF>/<*> blocks as SVs`

**Description and reproduction**
1. Import a 2-sample VCF containing `chr1 1000 . N <DEL> 60 PASS SVTYPE=DEL;END=5000 GT 0/1 0/0`. Both cases get the deletion; the second sample should not.
2. Import a GATK `.g.vcf` (reference blocks: `ALT=<NON_REF>`, `GT=0/0`, `INFO/END`). Every block is stored as `variant_type='sv'`.
3. Import a Jasmine- or SURVIVOR-merged trio SV VCF. Samples with `./.` get every SV.

Cause: `isStructural` skips the `carriedAltAlleles` check (`VcfMapper.ts:64` on HEAD).

**Expected behavior**
- Non-reference alleles (`<NON_REF>`, `<*>`, `*`; case-insensitive) are never targets.
- Whenever a GT is present, an ALT is imported only if the sample's GT carries that allele index, for SNVs and SVs alike.
- An SV with no genotype is imported only when:
  - `FORMAT` has no `GT` key; **or**
  - every GT allele is missing **and** the VCF has exactly one sample.

  These rows keep `gt_num` as written (zygosity unknown).
- Multi-sample VCFs with an all-missing GT import nothing for that sample.

**Proposed fix**
1. Add a `classifyGenotype(rawGt, hasGtField): 'carrier' | 'ref' | 'missing' | 'absent'` helper in `VcfMapper.ts` or `vcf-genotype-parser.ts`. Build it on `splitGenotypeAlleles` so any ploidy works: all parts `.` → `missing`, which fixes (c). Use it instead of the string comparisons on `'.'`, `'./.'` and `'.|.'`.
2. Add one `isNonVariantAllele(alt)` predicate covering `<NON_REF>`, `<*>` and `*`, with case-insensitive matching. This fixes (e).
3. Pass `header.samples.length` (or a `singleSample` flag) into the decision: for SVs, `missing` → import only if single-sample; `absent` → always import. This fixes (a) and (b).
4. Update the doc comment on `mapVcfRecord` to match. This fixes (f).
5. Add tests in `tests/main/import/vcf/vcf-mapper.test.ts` covering:
   - 0/0 and 0|0 SVs, symbolic and sequence-resolved;
   - multi-sample `./.` SVs (skip) vs single-sample `./.` SVs (import);
   - `FORMAT` without a `GT` key;
   - `./././.`;
   - `<NON_REF>`, `<*>`, `*` and `A,<NON_REF>` with `GT=0/2`.

   Also add one integration test through both the SQLite and Postgres VCF stream paths, asserting the per-case SV count for a 2-sample fixture.
6. Since existing databases may already hold false SVs, add a release note recommending that users re-import affected SV, multi-sample and gVCF imports. A data migration isn't possible because the source genotypes weren't kept.

**Verification:** `make typecheck`, then `make rebuild-node && make test`. Because the Postgres path is touched, also run `VARLENS_WEB=1 make test`.
