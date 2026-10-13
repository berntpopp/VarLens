/**
 * Offline concordance study (spec §4.4): background sites (patient data, local only) are
 * normalised and annotated with the local VEP 115 + dbNSFP pipeline and compared with the varvis
 * values; the public pool is compared genefoundry ↔ local VEP. Only the aggregate report is
 * written. Private intermediates live in PRIVATE_DIR and are deleted unless --keep-private.
 *
 *   npx jiti scripts/shortlist-sim/concordance/concordance.ts [--keep-private]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runLocalVep, type LocalVepRecord } from '../annotate/local-vep'
import { normalizeAlleles } from '../annotate/normalize'
import { projectToVarvis, vepTermKey } from '../annotate/project-varvis'
import type { SpikeAnnotation } from '../annotate/spike-annotation'
import { countBy, vepFromLocal } from '../annotate/freeze'
import {
  GENEFOUNDRY_CACHE_DIR,
  POOL_LOCAL_VEP_FILE,
  POOL_NORMALIZED_FILE,
  PRIVATE_DIR,
  ensurePrivateDir,
  REPO_ROOT,
  RUNS_DIR
} from '../common/paths'
import { loadBackgrounds, type Background } from './load-backgrounds'
import {
  AF_FIELDS,
  afStat,
  buildFuncMapping,
  buildImpactByFunc,
  caddStat,
  chooseAfField,
  funcAgreement,
  geneConstancy,
  localAf,
  spikeAf,
  TOLERANCE,
  verdict,
  type AfStat,
  type CaddStat,
  type ConcordanceReport,
  type Verdict,
  type Site
} from './metrics'

export const ARTIFACT = join(REPO_ROOT, '.planning/artifacts/shortlist-sim/concordance.json')

export interface BackgroundSites {
  bg: Background
  sites: Site[]
}

export interface PoolInput {
  annotations: SpikeAnnotation[]
  local: LocalVepRecord[]
}

function poolReport(
  pool: PoolInput,
  mapping: ConcordanceReport['funcMapping'],
  impactByFunc: ConcordanceReport['impactByFunc']
): NonNullable<ConcordanceReport['pool']> {
  const local = new Map(pool.local.map((r) => [r.key, r]))
  // Cross-check subset: genefoundry records with both VEP and gnomAD.
  const pairs = pool.annotations
    .filter((a) => a.vep !== null && a.gnomad !== null && local.has(a.key))
    .map((a) => ({ a, l: local.get(a.key)! }))
  // Unmapped share over the frozen spike source (local VEP, every pool variant).
  const byReason: Record<string, number> = {}
  for (const l of local.values()) {
    const v = vepFromLocal(l)
    const [, , ref, alt] = l.key.split(':')
    const p = projectToVarvis(v.mostSevere, v.consequenceTerms, mapping, impactByFunc, { ref, alt })
    byReason[p.reason] = (byReason[p.reason] ?? 0) + 1
  }
  const withVep = [...local.values()]
  const vepPairs = pairs.filter((p) => p.a.vep !== null)
  const unmapped = byReason.unmapped ?? 0
  return {
    n: pairs.length,
    vepPairs: vepPairs.length,
    afField: AF_FIELDS.map((f) =>
      afStat(
        f,
        pairs.map(({ a, l }) => [spikeAf(a, f), localAf(l, f)])
      )
    ),
    cadd: caddStat(pairs.map(({ a, l }) => [a.vep?.caddPhred ?? null, l.caddPhred])),
    termAgreement: vepPairs.filter(
      ({ a, l }) =>
        vepTermKey(a.vep!.mostSevere, a.vep!.consequenceTerms) === vepTermKey(l.mostSevere, l.terms)
    ).length,
    transcriptAgreement: vepPairs.filter(({ a, l }) => a.vep!.transcript === l.transcript).length,
    unmapped,
    unmappedShare: withVep.length > 0 ? unmapped / withVep.length : 0,
    byReason
  }
}

function missingness(
  sites: Site[],
  field: ConcordanceReport['acceptance']['afField']
): ConcordanceReport['missingness'] {
  const matched = sites.filter((s) => s.local !== null)
  const miss = (v: unknown): boolean => v === null || v === undefined
  return [
    {
      field: `gnomad_af~${field ?? 'none'}`,
      varvisMissing: matched.filter((s) => miss(s.varvis.gnomad_af)).length,
      localMissing: matched.filter((s) => field === null || miss(localAf(s.local!, field))).length,
      n: matched.length
    },
    {
      field: 'cadd',
      varvisMissing: matched.filter((s) => miss(s.varvis.cadd)).length,
      localMissing: matched.filter((s) => miss(s.local!.caddPhred)).length,
      n: matched.length
    },
    {
      field: 'func',
      varvisMissing: matched.filter((s) => miss(s.varvis.func)).length,
      localMissing: matched.filter((s) => s.local!.mostSevere === '').length,
      n: matched.length
    }
  ]
}

/** Pure: everything returned is aggregate. */
export function computeConcordance(
  input: BackgroundSites[],
  normalization: Record<string, number>,
  pool: PoolInput | null
): ConcordanceReport {
  const sites = input.flatMap((b) => b.sites)
  const funcMapping = buildFuncMapping(sites)
  const impactByFunc = buildImpactByFunc(input.flatMap((b) => b.bg.rows))
  const afFieldStats = AF_FIELDS.map((f) =>
    afStat(
      f,
      sites.filter((s) => s.local !== null).map((s) => [s.varvis.gnomad_af, localAf(s.local!, f)])
    )
  )
  const chosen = chooseAfField(afFieldStats)
  const cadd = caddStat(
    sites.filter((s) => s.local !== null).map((s) => [s.varvis.cadd, s.local!.caddPhred])
  )
  const poolR = pool === null ? null : poolReport(pool, funcMapping, impactByFunc)
  const afStatOf = (stats: AfStat[] | undefined): AfStat | undefined =>
    stats?.find((x) => x.field === chosen)
  const afVerdict = (st: AfStat | undefined): Verdict =>
    verdict(
      st?.n ?? 0,
      st?.medianAbsLog10Err != null && st.medianAbsLog10Err <= TOLERANCE.afMedianLog10
    )
  const caddVerdict = (c: CaddStat | undefined): Verdict =>
    verdict(
      c?.n ?? 0,
      c?.medianAbsErr != null &&
        c.pearson !== null &&
        c.medianAbsErr <= TOLERANCE.caddMedianAbs &&
        c.pearson >= TOLERANCE.caddPearson
    )
  const verdicts = {
    af: afVerdict(afStatOf(afFieldStats)),
    cadd: caddVerdict(cadd),
    poolAf: afVerdict(afStatOf(poolR?.afField)),
    poolCadd: caddVerdict(poolR?.cadd)
  }
  return {
    generatedAt: new Date().toISOString(),
    backgrounds: input.map((b) => ({
      label: b.bg.caseLabel,
      rows: b.bg.rows.length,
      skipped: b.bg.skipped,
      sites: b.sites.length,
      matched: b.sites.filter((s) => s.local !== null).length
    })),
    sites: sites.length,
    matched: sites.filter((s) => s.local !== null).length,
    normalization,
    transcriptSelection: countBy(
      sites.filter((x) => x.local !== null),
      (x) => x.local!.selection
    ),
    funcMapping,
    impactByFunc,
    funcAgreement: funcAgreement(sites, funcMapping, impactByFunc),
    afField: afFieldStats,
    cadd,
    missingness: missingness(sites, chosen),
    geneConstancy: geneConstancy(input.map((b) => b.bg)),
    pool: poolR,
    acceptance: {
      afField: chosen,
      afPass: verdicts.af.pass,
      caddPass: verdicts.cadd.pass,
      poolAfPass: verdicts.poolAf.pass,
      poolCaddPass: verdicts.poolCadd.pass,
      reasons: Object.fromEntries(
        Object.entries(verdicts).map(([k, v]) => [k, v.reason])
      ) as ConcordanceReport['acceptance']['reasons'],
      unmappedShare: poolR?.unmappedShare ?? null,
      unmappedFlag: (poolR?.unmappedShare ?? 0) > TOLERANCE.unmappedShare
    }
  }
}

/** Normalise and annotate all background sites locally (one VEP run over the union). */
async function annotateBackgrounds(
  bgs: Background[]
): Promise<{ input: BackgroundSites[]; normalization: Record<string, number> }> {
  const keyOf = (r: { chr: string; pos: number; ref: string; alt: string }): string =>
    `${r.chr}:${r.pos}:${r.ref}:${r.alt}`
  const alleles = bgs.flatMap((b) =>
    b.rows.map((r) => ({ key: keyOf(r), chr: r.chr, pos: r.pos, ref: r.ref, alt: r.alt }))
  )
  const norm = await normalizeAlleles(alleles, { tmpDir: PRIVATE_DIR })
  const normByInput = new Map(norm.map((n) => [n.input, n]))
  const normalization: Record<string, number> = {}
  for (const n of norm) normalization[n.status] = (normalization[n.status] ?? 0) + 1
  normalization.repositioned = norm.filter((n) => n.status === 'ok' && n.key !== n.input).length
  const ok = [...new Map(norm.filter((n) => n.status === 'ok').map((n) => [n.key, n])).values()]
  // Finished chunks are reused when an earlier run kept PRIVATE_DIR (--keep-private).
  // Transcript choice restricted to the varvis gene of the site (same rule as for spikes).
  const geneByKey = new Map<string, string | null>()
  for (const bg of bgs)
    for (const r of bg.rows) {
      const n = normByInput.get(keyOf(r))
      if (n?.status === 'ok' && !geneByKey.has(n.key)) geneByKey.set(n.key, r.gene_symbol)
    }
  const vep = await runLocalVep(
    ok.map((n) => ({ key: n.key, chr: n.chr, pos: n.pos, ref: n.ref, alt: n.alt })),
    join(PRIVATE_DIR, 'vep'),
    {
      // --no-dbnsfp: provisional run without CADD/joint AF (dbNSFP sits on a slow CIFS share).
      dbnsfp: !process.argv.includes('--no-dbnsfp'),
      geneOf: (key) => geneByKey.get(key) ?? null
    }
  )
  const byKey = new Map(vep.map((r) => [r.key, r]))
  const input = bgs.map((bg) => ({
    bg,
    sites: bg.rows.map((varvis) => {
      const n = normByInput.get(keyOf(varvis))
      return { varvis, local: n?.status === 'ok' ? (byKey.get(n.key) ?? null) : null }
    })
  }))
  return { input, normalization }
}

function loadPool(): PoolInput | null {
  if (!existsSync(POOL_LOCAL_VEP_FILE) || !existsSync(POOL_NORMALIZED_FILE)) return null
  const annotations = readdirSync(GENEFOUNDRY_CACHE_DIR).map(
    (f) => JSON.parse(readFileSync(join(GENEFOUNDRY_CACHE_DIR, f), 'utf8')) as SpikeAnnotation
  )
  const local = JSON.parse(readFileSync(POOL_LOCAL_VEP_FILE, 'utf8')) as LocalVepRecord[]
  return { annotations, local }
}

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep-private')
  ensurePrivateDir()
  try {
    const bgs = await loadBackgrounds()
    const { input, normalization } = await annotateBackgrounds(bgs)
    const report = computeConcordance(input, normalization, loadPool())
    const text = JSON.stringify(report, null, 2) + '\n'
    const run = join(
      RUNS_DIR,
      `concordance-${createHash('sha1').update(text).digest('hex').slice(0, 8)}`
    )
    mkdirSync(run, { recursive: true })
    writeFileSync(join(run, 'concordance.json'), text)
    mkdirSync(join(ARTIFACT, '..'), { recursive: true })
    writeFileSync(ARTIFACT, text)
    console.log(
      JSON.stringify(
        {
          ...report,
          funcMapping: report.funcMapping.length,
          impactByFunc: report.impactByFunc.length
        },
        null,
        1
      )
    )
    console.log(`wrote ${ARTIFACT} and ${run}`)
  } finally {
    if (!keep) rmSync(PRIVATE_DIR, { recursive: true, force: true })
  }
}

if (process.argv[1]?.endsWith('concordance.ts')) {
  main().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
