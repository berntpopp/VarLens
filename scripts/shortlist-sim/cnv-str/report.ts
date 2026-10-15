/** Aggregate markdown report of the CNV/STR benchmark against the pre-registered criteria. */
import type { Interval } from '../stats/bootstrap'
import { quantile } from '../stats/bootstrap'
import type { NoiseLevelId } from '../phenotype/profiles'
import { CNV_ARMS } from './cnv-arms'
import type { CnvRun } from './cnv-bench'
import type { StrRun } from './str-bench'
import { armTable, fmt, pairedDelta, type CaseMetrics } from './summary'

export interface Checks {
  indexLoadMs: number
  latency: { p95: number; median: number; n: number; cnvs: number }
  invariance: { profiles: number; genes: number; genesV6: number; mismatches: number }
  sources: string
}

interface Verdict {
  id: string
  pass: boolean
  value: string
}

const median = (xs: number[]): number =>
  quantile(
    [...xs].filter(Number.isFinite).sort((a, b) => a - b),
    0.5
  )
const pp = (i: Interval): string => `Δ ${fmt(i)} pp`

export function verdicts(cnv: CnvRun, str: StrRun, checks: Checks): Verdict[] {
  const realD = pairedDelta(cnv.real, 'A3', 'A0', 'h10')
  const largeA0H1 = pairedDelta(cnv.sim.moderate.large, 'A3', 'A0', 'h1')
  const largeRegH10 = pairedDelta(cnv.sim.moderate.large, 'A3', 'region', 'h10')
  const largeSumH10 = pairedDelta(cnv.sim.moderate.large, 'A3', 'sum', 'h10')
  const regions = cnv.sim.moderate.all.filter((c) => c.source === 'region')
  const regionH1 = pairedDelta(regions, 'A3', 'A0', 'h1')
  const regionH10 = pairedDelta(regions, 'A3', 'A0', 'h10')
  const rhoA3 = median(cnv.real.flatMap((c) => c.rho.map((r) => r.A3)))
  const rhoA0 = median(cnv.real.flatMap((c) => c.rho.map((r) => r.A0)))
  const inv = checks.invariance
  const strD = pairedDelta(str.causal.population.moderate, 'new', 'baseline', 'h1')
  const noDecoy = (Object.keys(str.causal.none) as NoiseLevelId[]).map((lv) => ({
    lv,
    d: pairedDelta(str.causal.none[lv], 'new', 'baseline', 'h1')
  }))
  const falseLeads = str.tricks.reduce((n, t) => n + t.falseLeads, 0)
  return [
    {
      id: 'CNV-1',
      pass: realD.estimate >= -0.02,
      value: `A3 − A0 Hit@10 ${pp(realD)} (bar ≥ −2.0)`
    },
    {
      id: 'CNV-2',
      pass:
        cnv.sim.moderate.large.length > 0 &&
        largeA0H1.estimate > 0 &&
        largeA0H1.lo > 0 &&
        largeRegH10.estimate >= 0.5 &&
        largeRegH10.lo > 0 &&
        largeSumH10.estimate >= 0.05 &&
        largeSumH10.lo > 0,
      value: `A3 − A0 Hit@1 ${pp(largeA0H1)} (lo > 0); A3 − region Hit@10 ${pp(largeRegH10)} (bar ≥ +50.0); A3 − sum Hit@10 ${pp(largeSumH10)} (bar ≥ +5.0, lo > 0), n = ${cnv.sim.moderate.large.length}`
    },
    {
      id: 'CNV-3',
      pass:
        regions.length > 0 &&
        regionH1.estimate >= 0.2 &&
        regionH1.lo > 0 &&
        regionH10.estimate >= 0.1 &&
        regionH10.lo > 0,
      value: `A3 − A0 Hit@1 ${pp(regionH1)} (bar ≥ +20.0); Hit@10 ${pp(regionH10)} (bar ≥ +10.0), n = ${regions.length}`
    },
    {
      id: 'CNV-4',
      pass: rhoA3 <= 0.25,
      value: `median ρ A3 ${rhoA3.toFixed(3)} (A0 ${rhoA0.toFixed(3)}; bar ≤ 0.25)`
    },
    {
      id: 'CNV-5',
      pass: inv.mismatches === 0 && inv.genes === inv.genesV6,
      value: `${inv.mismatches} of ${inv.profiles} profiles differ over ${inv.genes} genes (v6: ${inv.genesV6})`
    },
    {
      id: 'CNV-6',
      pass: checks.latency.p95 <= 5 && checks.indexLoadMs <= 50,
      value: `p95 ${checks.latency.p95.toFixed(2)} ms at ${checks.latency.cnvs} CNVs (median ${checks.latency.median.toFixed(2)}); index load ${checks.indexLoadMs.toFixed(1)} ms`
    },
    {
      id: 'STR-1',
      pass: falseLeads === 0,
      value: `${falseLeads} false leads in ${str.tricks.reduce((n, t) => n + t.cases, 0)} trick cases`
    },
    {
      id: 'STR-2',
      pass: strD.estimate >= 0.05 && strD.lo > 0,
      value: `new − baseline Hit@1 ${pp(strD)} (bar ≥ +5.0, lo > 0)`
    },
    {
      id: 'STR-3',
      pass: noDecoy.every((x) => x.d.estimate >= -0.01),
      value: noDecoy.map((x) => `${x.lv} ${pp(x.d)}`).join('; ') + ' (bar ≥ −1.0 each)'
    },
    {
      id: 'STR-4',
      pass: str.admitted.every((a) => a.score !== null && a.score > 0),
      value: str.admitted.map((a) => `${a.id} ${a.score?.toFixed(3) ?? 'null'}`).join(', ')
    }
  ]
}

const section = (title: string, cases: CaseMetrics[], arms: readonly string[]): string =>
  `### ${title}\n\n${armTable(cases, arms)}\n`

function realPerClusterTable(real: CnvRun['real']): string {
  const byCluster = new Map<string, CnvRun['real']>()
  for (const c of real) {
    const list = byCluster.get(c.cluster)
    if (list === undefined) byCluster.set(c.cluster, [c])
    else list.push(c)
  }
  const pct = (xs: number[]): string =>
    ((100 * xs.reduce((a, b) => a + b, 0)) / xs.length).toFixed(1)
  const rows = [...byCluster.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .map(
      ([cluster, cs]) =>
        `| ${cluster} | ${cs.length} | ${pct(cs.map((c) => c.arms.A0.h1))} | ${pct(cs.map((c) => c.arms.A0.h10))} | ${pct(cs.map((c) => c.arms.A3.h1))} | ${pct(cs.map((c) => c.arms.A3.h10))} |`
    )
  return [
    '### Real cases per locus cluster (#642)',
    '',
    '| Cluster | Cases | A0 Hit@1 (%) | A0 Hit@10 (%) | A3 Hit@1 (%) | A3 Hit@10 (%) |',
    '|---|---|---|---|---|---|',
    ...rows,
    ''
  ].join('\n')
}

export function renderReport(cnv: CnvRun, str: StrRun, checks: Checks, commit: string): string {
  const v = verdicts(cnv, str, checks)
  const levels = Object.keys(cnv.sim) as NoiseLevelId[]
  const bg = (Object.entries(cnv.backgrounds) as Array<[string, CnvRun['backgrounds']['GRCh37']]>)
    .map(
      ([b, xs]) =>
        `- ${b}: ${xs.map((x) => `${x.calls}${x.large ? '*' : ''}`).join(', ')} calls (* ≥ 1 Mb carrier)`
    )
    .join('\n')
  return [
    '# CNV/STR phenotype scoring: validation report',
    '',
    `Protocol: \`protocol.md\` (pre-registered, see \`protocol.md\`). Code at \`${commit}\`.`,
    `Data: ${checks.sources}.`,
    '',
    '## Criteria',
    '',
    '| # | Result | Value |',
    '|---|---|---|',
    ...v.map((x) => `| ${x.id} | ${x.pass ? 'PASS' : '**FAILED**'} | ${x.value} |`),
    '',
    `CNV: ${v.filter((x) => x.id.startsWith('CNV')).every((x) => x.pass) ? 'all pass' : 'not all pass, flag stays off'}. ` +
      `STR: ${v.filter((x) => x.id.startsWith('STR')).every((x) => x.pass) ? 'all pass' : 'not all pass, flag stays off'}.`,
    '',
    '## CNV',
    '',
    `Counts: ${Object.entries(cnv.counts)
      .map(([k, x]) => `${k} ${x}`)
      .join(', ')}.`,
    '',
    'Backgrounds (calls ≥ 1 kb per sample):',
    bg,
    '',
    'Hit@k and MRR in %, 95 % locus-clustered bootstrap CIs (2,000 replicates).',
    '',
    section('Real cases (phenopacket-store 0.1.27, observed terms)', cnv.real, CNV_ARMS),
    realPerClusterTable(cnv.real),
    ...levels.map((lv) => section(`Simulation, ${lv}, all backgrounds`, cnv.sim[lv].all, CNV_ARMS)),
    section('Simulation, moderate, ≥ 1 Mb backgrounds (CNV-2)', cnv.sim.moderate.large, CNV_ARMS),
    section(
      'Simulation, moderate, ClinGen region cases (CNV-3)',
      cnv.sim.moderate.all.filter((c) => c.source === 'region'),
      CNV_ARMS
    ),
    section(
      'Simulation, moderate, ClinVar non-region cases',
      cnv.sim.moderate.all.filter((c) => c.source === 'clinvar'),
      CNV_ARMS
    ),
    '## STR',
    '',
    `Catalogue loci (hg38): ${str.loci}; causal loci: ${str.causalLoci}.`,
    '',
    ...(['none', 'population', 'all'] as const).flatMap((d) =>
      (Object.keys(str.causal[d]) as NoiseLevelId[]).map((lv) =>
        section(`Causal, decoys ${d}, ${lv}`, str.causal[d][lv], ['new', 'baseline'])
      )
    ),
    '### Trick arms (STR-1)',
    '',
    '| Arm | Cases | False leads | Examples |',
    '|---|---|---|---|',
    ...str.tricks.map(
      (t) => `| ${t.name} | ${t.cases} | ${t.falseLeads} | ${t.examples.join('; ')} |`
    ),
    ''
  ].join('\n')
}
