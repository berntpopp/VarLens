import { readFileSync } from 'fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')

describe('web CI target wiring', () => {
  test('root Makefile keeps web CI explicit and Postgres-gated', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8')

    const commands = execFileSync('make', ['-n', 'web-ci'], { cwd: ROOT, encoding: 'utf8' })
    expect(commands.match(/^VARLENS_WEB_BASE=\/ npm run build:web$/gm)).toHaveLength(1)
    expect(commands.match(/^npm run rebuild:node$/gm)).toHaveLength(1)
    expect(
      commands.match(/^npx vitest run --project web-gate tests\/web-gate\/integration$/gm)
    ).toHaveLength(1)
    expect(commands).toContain("--exclude 'tests/web-gate/integration/**'")
    expect(makefile).toContain('out/web/server.cjs and out/web/public/index.html are required')
    expect(makefile).toMatch(/^web-gate-parity: web-data-verify/m)
    expect(makefile).toContain('VARLENS_PG_URL is required for web-gate-postgres')
    // `ci` keeps memory-heavy checks serialized. The npm scripts already do their
    // own caching, so Make-level fan-out only raises peak RSS on local machines.
    expect(makefile).toMatch(/^ci:.*Run all CI checks/m)
    expect(makefile).not.toMatch(/\$\(MAKE\)\s+-j\d+/)
    expect(makefile).toMatch(/^\t\$\(MAKE\) lint-check$/m)
    expect(makefile).toMatch(/^\t\$\(MAKE\) format-check$/m)
    expect(makefile).toMatch(/^\t\$\(MAKE\) typecheck$/m)
    expect(makefile).toMatch(/^\t\$\(MAKE\) rebuild-node$/m)
    expect(makefile).toMatch(/^\t\$\(MAKE\) test$/m)
    expect(makefile).toMatch(/^VARLENS_WEB \?= 0/m)
    expect(makefile).not.toMatch(/wildcard .*\.env/)
  })

  test('npm quality scripts avoid unbounded local resource fan-out', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const { scripts } = packageJson

    expect(scripts.lint).toContain('--concurrency=off')
    expect(scripts['lint:check']).toContain('--concurrency=off')
    expect(scripts.lint).not.toContain('--concurrency=auto')
    expect(scripts['lint:check']).not.toContain('--concurrency=auto')
    expect(scripts.typecheck).not.toContain('run-p')
    expect(scripts.typecheck).toContain('npm run typecheck:renderer && npm run typecheck:node')
    expect(scripts.format).not.toMatch(/prettier --cache --write \.$/)
    expect(scripts['format:check']).not.toMatch(/prettier --cache --check \.$/)
    expect(scripts.format).toContain('"{src,tests,scripts,.github}/**/*.')
    expect(scripts['format:check']).toContain('"{src,tests,scripts,.github}/**/*.')
  })

  test('web report treats VARLENS_WEB=1 as full parity mode', () => {
    const reportFiles = {
      runner: readFileSync(resolve(ROOT, 'scripts/reports/run-web-test-report.mjs'), 'utf8'),
      context: readFileSync(resolve(ROOT, 'scripts/reports/web-report-context.mjs'), 'utf8'),
      ctrf: readFileSync(resolve(ROOT, 'scripts/reports/web-report-ctrf.mjs'), 'utf8'),
      data: readFileSync(resolve(ROOT, 'scripts/reports/web-report-data.mjs'), 'utf8'),
      stakeholder: readFileSync(
        resolve(ROOT, 'scripts/reports/web-report-stakeholder.mjs'),
        'utf8'
      ),
      pdf: readFileSync(resolve(ROOT, 'scripts/reports/web-report-pdf.mjs'), 'utf8')
    }
    const { runner } = reportFiles
    const combinedReportSource = Object.values(reportFiles).join('\n')

    expect(runner).toContain("const webMode = process.env.VARLENS_WEB === '1'")
    expect(runner).toContain(
      "const runParity = webMode || process.env.VARLENS_WEB_REPORT_PARITY === '1'"
    )
    expect(runner).toContain("process.env.VARLENS_WEB_REPORT_PARITY === '1'")
    expect(runner).toContain("process.env.VARLENS_WEB_REPORT_PARITY_E2E === '1'")
    expect(runner).toContain('loadLocalPostgresEnvForWebMode()')
    expect(runner).toContain('process.env.VARLENS_RECOVERY_KEY_DIR = resolve(runDir,')
    expect(runner).toContain('renderStakeholderReport(manifest, ctrf, reportAssessment)')
    expect(runner).toContain('buildReportAssessment(manifest, runDir)')
    expect(runner).toContain('compactReportPackage(runDir)')
    expect(runner).toContain('publishLatestReport(runDir)')
    expect(combinedReportSource).toContain('hashMatch: scenario.hashMatch')
    expect(combinedReportSource).toContain('matching SHA-256 fingerprints')
    expect(combinedReportSource).toContain("hasIpcParityGaps ? 'incomplete' : 'passed'")
    expect(combinedReportSource).toContain('Electron Postgres vs Web Postgres IPC parity:')
    expect(combinedReportSource).toContain('Incomplete: IPC parity gaps')
    expect(combinedReportSource).toContain('stakeholderIpcAreas')
    expect(combinedReportSource).toContain('## Abstract')
    expect(combinedReportSource).toContain('## Validation Scope')
    expect(combinedReportSource).toContain('## Methodology')
    expect(combinedReportSource).toContain('## IPC Traceability Matrix')
    expect(combinedReportSource).toContain('## Domain Data Parity')
    expect(combinedReportSource).toContain('## Limitations')
    expect(combinedReportSource).toContain('## Conclusion')
    expect(combinedReportSource).toContain('flatIpcHandlers')
    expect(combinedReportSource).toContain('stakeholder-report.pdf')
    expect(runner).toContain("'stakeholder-report.md'")
    expect(runner).toContain("'vitest'")
    expect(runner).toContain(
      "skippedSuite('web-gate-postgres', 'VARLENS_PG_URL is not set', webMode)"
    )
  })

  test('web publish workflow runs web-ci before building images', () => {
    const publish = readFileSync(resolve(ROOT, '.github/workflows/publish-web.yml'), 'utf8')

    expect(publish).toMatch(/web-ci:[\s\S]*?run: make web-ci/)
    expect(publish).toMatch(/build-and-push:[\s\S]*?needs: web-ci/)
    expect(publish).not.toMatch(/branches: \[main\]/)
    expect(publish).toMatch(/Trivy gate[\s\S]*?Push scanned image/)
  })

  test('web publish workflow ignores desktop releases', () => {
    const publish = readFileSync(resolve(ROOT, '.github/workflows/publish-web.yml'), 'utf8')

    expect(publish).toContain("startsWith(github.event.release.tag_name, 'web-')")
    expect(publish).toContain('desktop-release-skipped:')
    expect(publish).toContain('desktop releases such as `v0.68.0`')
  })
})
