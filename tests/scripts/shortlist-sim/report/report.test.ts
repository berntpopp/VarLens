import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CASE_MODES,
  CONSEQUENCE_CLASSES,
  type CaseResult,
  type RunManifest,
  type ScenarioId
} from '../../../../scripts/shortlist-sim/common/types'
import { renderReport } from '../../../../scripts/shortlist-sim/report/report'
import { mulberry32 } from '../../../../scripts/shortlist-sim/stats/prng'

const SCORERS = [
  { id: 'tier1', label: 'Tier 1 candidates', base: 12 },
  { id: 'evidence_tuned', label: 'Evidence (tuned)', base: 2 },
  { id: 'evidence_no_cadd', label: 'Evidence without CADD', base: 4 }
]

function synthResults(genes: number, seed: number): CaseResult[] {
  const rnd = mulberry32(seed)
  const out: CaseResult[] = []
  for (let g = 0; g < genes; g++) {
    const mode = CASE_MODES[g % 3] // AD, AR_HOM, AR_COMPHET; XLD stays below 30 cases
    const nAlleles = mode === 'AR_COMPHET' ? 2 : 1
    for (const scenario of ['primary', 'clinvar_visible'] as ScenarioId[]) {
      for (const s of SCORERS) {
        // Distinct, consistent tie groups: each allele ties with `equal` rows ranked after it.
        let next = 1 + Math.floor(rnd() * s.base * 2)
        const alleles = Array.from({ length: nAlleles }, () => {
          const equal = Math.floor(rnd() * 3)
          const a = { rank: next, higher: next - 1, equal }
          next += equal + 1 + Math.floor(rnd() * s.base)
          return a
        })
        out.push({
          caseId: `case-${g}`,
          scorer: s.id,
          scenario,
          fold: g % 5,
          mode,
          consequenceClass: CONSEQUENCE_CLASSES[g % 4],
          bg: g % 2 === 0 ? 'bgA' : 'bgB',
          gene: `GENE${g}`,
          newSince2024: g % 7 === 0,
          alleles,
          decoysTop10: Math.floor(rnd() * 2),
          eligible: 300 + Math.floor(rnd() * 50),
          causalEligible: alleles.map(() => true)
        })
      }
    }
  }
  // A few XLD cases: reported per mode, dropped from the pooled endpoint.
  out.push({ ...out[0], caseId: 'xld-1', mode: 'XLD', scorer: 'evidence_tuned' })
  return out
}

const manifest: RunManifest = {
  run: 'synthetic',
  createdAt: '2026-10-12T00:00:00Z',
  quick: true,
  seeds: { folds: 1, bootstrap: 2 },
  bootstrapReps: 200,
  inputHashes: { pool: 'a'.repeat(64) },
  poolFunnel: [
    { step: 'ClinVar P/LP records', count: 100000 },
    { step: 'Sampled pool', count: 4000 }
  ],
  concordance: {
    checks: [
      {
        field: 'gnomad_af',
        metric: 'median |Δlog10|',
        value: 0.04,
        threshold: '≤ 0.1',
        accepted: true
      },
      { field: 'cadd', metric: 'median |Δ|', value: 0.9, threshold: '≤ 0.5', accepted: false }
    ],
    funcUnmappedShare: 0.08,
    disabledGroups: ['cadd']
  },
  tuned: {
    A: 900,
    B: 12000,
    bins: [
      {
        group: 'freq',
        bin: 'af_lt_1e5',
        isReference: false,
        a: 300,
        b: 900,
        points: 3.5,
        supported: true,
        lo: 3.1,
        hi: 3.9
      },
      {
        group: 'freq',
        bin: 'af_ref',
        isReference: true,
        a: 50,
        b: 6000,
        points: 0,
        supported: true
      }
    ]
  },
  scorers: {
    reference: 'tier1',
    candidate: 'evidence_tuned',
    ablations: ['evidence_no_cadd'],
    all: SCORERS.map(({ id, label }) => ({ id, label }))
  }
}

function render(genes: number): {
  md: string
  files: string[]
  data: ReturnType<typeof renderReport>
} {
  const dir = mkdtempSync(join(tmpdir(), 'shortlist-report-'))
  writeFileSync(
    join(dir, 'results.jsonl'),
    synthResults(genes, 5)
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  )
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  const out = join(dir, 'out')
  const data = renderReport(dir, out)
  const files = ['report.md', 'rank-cdf.svg', 'hit-at-10.svg', 'metrics.json'].map((f) =>
    readFileSync(join(out, f), 'utf8')
  )
  return { md: files[0], files, data }
}

describe('simulation report', () => {
  const big = render(360)

  it('renders every section', () => {
    for (const heading of [
      '## Ship verdict',
      '## Primary endpoint',
      '### Per mode',
      '### Per consequence class',
      '### Per background',
      '### Temporal stratum',
      '## Scenarios',
      '## Decoy intrusion',
      '## Filter sensitivity and burden',
      '## Tuned points',
      '## Ablations',
      '## Pool selection funnel',
      '## Annotation concordance',
      '## Provenance'
    ]) {
      expect(big.md).toContain(heading)
    }
    expect(big.md).toContain('Validity threat')
    expect(big.md).toContain('Groups disabled by annotation acceptance (0 points everywhere): cadd')
    expect(big.md).toContain('![Rank CDF](rank-cdf.svg)')
  })

  it('ships when the synthetic candidate clearly beats the reference', () => {
    expect(big.data.ship.ship).toBe(true)
    expect(big.md).toContain('**Verdict: SHIP**')
    expect(big.data.pooledModes).toEqual(['AD', 'AR_HOM', 'AR_COMPHET'])
    expect(big.data.droppedModes).toEqual(['XLD'])
    expect(big.data.testGeneClusters).toBe(360)
    const cand = big.data.scorers.find((s) => s.id === 'evidence_tuned')
    expect(cand?.deltaHit10?.lo).toBeGreaterThan(0.03)
  })

  it('does not ship an underpowered run and says why', () => {
    const small = render(40)
    expect(small.data.ship.ship).toBe(false)
    expect(small.md).toContain('**Verdict: DO NOT SHIP**')
    expect(small.md).toContain('Underpowered')
    expect(small.data.ship.reasons.some((r) => r.startsWith('Test gene clusters'))).toBe(true)
  })

  it('emits self-contained SVGs with a dark-mode palette', () => {
    for (const svg of big.files.slice(1, 3)) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
      expect(svg).toContain('prefers-color-scheme:dark')
      expect(svg).not.toMatch(/(href|src)=/)
    }
    expect(big.files[1]).toContain('Evidence (tuned)')
  })

  it('contains no row-level coordinates', () => {
    for (const text of big.files) expect(text).not.toMatch(/\b(chr)?([0-9]{1,2}|X|Y|MT?):[0-9]{3,}/)
  })
})
