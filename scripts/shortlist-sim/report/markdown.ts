// Markdown sections of the simulation report (aggregates only).
import type { RunManifest } from '../common/types'
import type { Interval } from '../stats/bootstrap'
import { HIT_KS, type ReportData } from './analysis'

export const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(1)} %` : '–')
const num = (v: number, d = 2): string =>
  Number.isFinite(v) ? v.toFixed(d) : v === Number.POSITIVE_INFINITY ? '∞' : '–'
const signed = (v: number, d: number): string => (v > 0 ? '+' : '') + v.toFixed(d)
export const ci = (i: Interval): string =>
  Number.isFinite(i.estimate) ? `${pct(i.estimate)} [${pct(i.lo)}, ${pct(i.hi)}]` : '–'
/** Difference of shares in percentage points with its interval. */
export const dpts = (i?: Interval): string =>
  i && Number.isFinite(i.estimate)
    ? `${signed(i.estimate * 100, 1)} [${signed(i.lo * 100, 1)}, ${signed(i.hi * 100, 1)}] pts`
    : '–'
const dnum = (i?: Interval): string =>
  i && Number.isFinite(i.estimate)
    ? `${signed(i.estimate, 2)} [${signed(i.lo, 2)}, ${signed(i.hi, 2)}]`
    : '–'

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n')
}

export function verdictSection(d: ReportData): string {
  const v = d.ship
  const head = v.ship
    ? '**Verdict: SHIP** — every pre-registered criterion (spec §11.5) holds; the tuned preset may be seeded as a non-default beta.'
    : '**Verdict: DO NOT SHIP** — at least one pre-registered criterion (spec §11.5) fails; no preset is seeded.'
  const rows = v.checks.map((c) => [
    c.description,
    Number.isInteger(c.value) ? String(c.value) : num(c.value, 4),
    c.threshold,
    c.pass ? 'pass' : '**FAIL**'
  ])
  const notes = [
    `Pooled mode strata: ${v.pooledModes.join(', ') || 'none'}.`,
    v.droppedModes.length
      ? `Dropped from the pooled endpoint (< 30 cases, reported separately): ${v.droppedModes.join(', ')}.`
      : '',
    ...v.reasons.map((r) => `- Failed: ${r}`)
  ].filter(Boolean)
  return [
    '## Ship verdict',
    head,
    table(['Criterion', 'Value', 'Needs', 'Result'], rows),
    ...notes
  ].join('\n\n')
}

export function primarySection(d: ReportData, reference: string): string {
  const rows = d.scorers.map((s) => [
    s.label,
    String(s.n),
    ci(s.hit10),
    ...HIT_KS.filter((k) => k !== 10).map((k) => pct(s.hit[k])),
    pct(s.tieHit10),
    num(s.mrr, 3),
    num(s.tieMrr, 3),
    num(s.medianRank, 1),
    s.id === reference ? 'reference' : dpts(s.deltaHit10)
  ])
  return [
    '## Primary endpoint',
    `Primary scenario (ClinVar masked on all rows, pins off), test folds, Hit@k macro-averaged over consequence classes and pooled over ${d.pooledModes.join(', ') || 'no'} modes. Intervals: 95 % gene-cluster bootstrap. Δ = scorer − reference, paired over the same resampled clusters.`,
    d.underpowered
      ? `> **Underpowered:** ${d.testGeneClusters} test gene clusters (< 300 required).`
      : `Test gene clusters: ${d.testGeneClusters}.`,
    table(
      [
        'Scorer',
        'Cases',
        'Hit@10 [95 % CI]',
        'Hit@1',
        'Hit@5',
        'Hit@20',
        'Hit@50',
        'Tie-avg Hit@10',
        'MRR',
        'Tie-avg MRR',
        'Median rank',
        'ΔHit@10 vs reference'
      ],
      rows
    ),
    '![Hit@10 with 95 % CI](hit-at-10.svg)',
    '![Rank CDF](rank-cdf.svg)'
  ].join('\n\n')
}

function strataTable(
  title: string,
  note: string,
  d: ReportData,
  data: ReportData['byMode']
): string {
  const head = ['Stratum', 'Cases', ...d.scorers.map((s) => s.label)]
  const rows = data.map((r) => [r.stratum, String(r.n), ...r.values.map(pct)])
  return [`### ${title}`, note, table(head, rows)].join('\n\n')
}

export function strataSection(d: ReportData): string {
  return [
    '## Strata (Hit@10, primary scenario)',
    strataTable(
      'Per mode',
      'Macro over classes within the mode; all modes shown, including strata dropped from the pooled endpoint.',
      d,
      d.byMode
    ),
    `X-linked stratum (XLD + XLR, ${d.xl.n} cases; XLR only in male backgrounds): candidate Hit@10 ${ci(d.xl.hit10)}, Δ vs reference ${dpts(d.xl.deltaHit10)}.`,
    strataTable(
      'Per consequence class',
      'Plain mean within the class (spec §11.2 class of a case).',
      d,
      d.byClass
    ),
    strataTable(
      'Per background',
      'Per-background results of the cross-validated (gene-fold) evaluation; backgrounds are not held out. Leave-one-background-out was not performed: the shipped hand-set ruleset has no fitted parameters, so a background hold-out does not apply to it.',
      d,
      d.byBackground
    ),
    strataTable(
      'Temporal stratum',
      'P/LP absent or not P/LP in ClinVar 2024-01 vs older.',
      d,
      d.byTemporal
    )
  ].join('\n\n')
}

export function scenarioSection(d: ReportData): string {
  const head = ['Scenario', 'Cases', ...d.scorers.map((s) => s.label), 'Δ candidate − reference']
  const rows = d.scenarios.map((s) => [
    s.scenario,
    String(s.n),
    ...s.values.map(pct),
    dpts(s.delta)
  ])
  return ['## Scenarios (Hit@10, macro)', table(head, rows)].join('\n\n')
}

export function decoySection(d: ReportData, reference: string): string {
  const rows = d.scorers.map((s) => [
    s.label,
    num(s.decoys.mean, 2),
    pct(s.decoys.shareAny),
    s.id === reference ? 'reference' : dnum(s.deltaDecoys)
  ])
  return [
    '## Decoy intrusion',
    '10 rare benign decoys per case; primary scenario.',
    table(
      ['Scorer', 'Mean decoys in top 10', 'Cases with ≥ 1', 'Δ mean vs reference [95 % CI]'],
      rows
    )
  ].join('\n\n')
}

export function sensitivitySection(d: ReportData): string {
  const rows = d.scorers.map((s) => [
    s.label,
    pct(s.sensitivity),
    `${s.sensitivityClusters.n - s.sensitivityClusters.failures}/${s.sensitivityClusters.n}`,
    pct(s.sensitivityClusters.lower),
    num(s.burden, 0)
  ])
  return [
    '## Filter sensitivity and burden',
    'Allele sensitivity = causal alleles passing the scorer’s gate. Cluster bound: one-sided 97.5 % Clopper–Pearson lower bound, failure = gene cluster with ≥ 1 gated-out causal allele. Burden = median eligible rows per case.',
    table(
      ['Scorer', 'Allele sensitivity', 'Clusters passing', 'Cluster lower bound', 'Median burden'],
      rows
    )
  ].join('\n\n')
}

export function pointsSection(m: RunManifest): string {
  if (m.frozenRuleset !== undefined)
    return `## Points\n\nFrozen rerun: the ruleset \`${m.frozenRuleset}\` was evaluated unchanged in every fold; nothing was tuned.`
  const rows = m.tuned.bins.map((b) => [
    b.group,
    b.bin + (b.isReference ? ' (catch-all)' : '') + (b.isAnchor ? ' (anchor)' : ''),
    String(b.a),
    String(b.b),
    b.tuned === false
      ? `${signed(b.points, 1)} (prior, not tuned)`
      : b.supported
        ? signed(b.points, 1)
        : '0 (unsupported)',
    Number.isFinite(b.lo) && Number.isFinite(b.hi)
      ? `[${signed(b.lo!, 2)}, ${signed(b.hi!, 2)}]`
      : '–'
  ])
  const disabled = m.concordance.disabledGroups
  return [
    '## Tuned points (refit on all folds)',
    `Spec §14–15 (amend §11.1): points = log2 enrichment (pseudo-count ½) relative to the group’s anchor — the bin with the most training positives (0 points) — rounded to 0.5, clipped ±8; a group is a complete partition, so the anchor choice does not change any ranking. A bin with a + b < 10 gets 0; a bin with fewer than 5 positives can only score at or below the anchor; a group with fewer than 20 training positives gets 0 throughout. ClinVar is tuned only as P/LP vs the pooled other ClinVar bins (spikes are all P/LP, so the other bins are not identifiable); those keep their template points as non-tuned priors. Positives A = ${m.tuned.A}, background rows B = ${m.tuned.B} (primary scenario). Intervals: 95 % gene-cluster bootstrap of the unrounded points, relative to the same anchor.`,
    'Protocol note: §14 (anchor) and §15 (most-positive anchor, no bonus for bins with < 5 positives, ClinVar priors) amended the §11.1 estimator after a smoke run (bg1, provisional mapping) and the quick run (bg1, 50 cases) exposed estimator artefacts — all-zero groups under the reference-bin support rule, then positive points for bins without positives. The amendments target the estimator, not observed performance; `evidence_hand` (fully pre-registered points) is reported next to `evidence_tuned` as the pre-registered comparator, and the ship rule is evaluated for both.',
    disabled.length
      ? `Groups disabled by annotation acceptance (0 points everywhere): ${disabled.join(', ')}.`
      : '',
    table(['Group', 'Bin', 'a', 'b', 'Points', 'Bootstrap interval'], rows)
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function ablationSection(d: ReportData): string {
  if (d.ablations.length === 0) return '## Ablations\n\nNo ablation scorers in this run.'
  return [
    '## Ablations',
    'ΔHit@10 = ablation − tuned evidence scorer, primary scenario, paired gene-cluster bootstrap.',
    table(
      ['Ablation', 'ΔHit@10 [95 % CI]'],
      d.ablations.map((a) => [a.label, dpts(a.delta)])
    )
  ].join('\n\n')
}

export function funnelSection(m: RunManifest): string {
  return [
    '## Pool selection funnel',
    table(
      ['Step', 'Remaining'],
      m.poolFunnel.map((f) => [f.step, String(f.count)])
    )
  ].join('\n\n')
}

export function concordanceSection(m: RunManifest): string {
  const c = m.concordance
  const rows = c.checks.map((k) => [
    k.field,
    k.metric,
    num(k.value, 3),
    k.threshold,
    k.accepted ? 'accepted' : '**excluded**'
  ])
  const flag =
    c.funcUnmappedShare > 0.05
      ? `> **Validity threat:** ${pct(c.funcUnmappedShare)} of the pool excluded for an unmapped \`func\` term (> 5 %).`
      : `Pool excluded for an unmapped \`func\` term: ${pct(c.funcUnmappedShare)}.`
  return [
    '## Annotation concordance (spec §11.4)',
    table(['Field', 'Metric', 'Value', 'Tolerance', 'Decision'], rows),
    flag
  ].join('\n\n')
}

export function provenanceSection(m: RunManifest): string {
  const seeds = Object.entries(m.seeds).map(([k, v]) => [k, String(v)])
  const hashes = Object.entries(m.inputHashes).map(([k, v]) => [k, `\`${v}\``])
  return [
    '## Provenance',
    `Bootstrap replicates: ${m.bootstrapReps}.`,
    table(['Seed', 'Value'], seeds),
    table(['Input', 'SHA-256'], hashes)
  ].join('\n\n')
}
