import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const workflow = (name: string) => read(`.github/workflows/${name}.yml`)
const job = (source: string, name: string) =>
  source.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? ''

describe('hosted gate contracts', () => {
  test('one PR web gate, with explicit draft-to-ready transition', () => {
    const build = workflow('build')
    expect(build).toContain('ready_for_review')
    expect(workflow('web-ci')).not.toContain('pull_request:')
    expect(workflow('web-ci')).toContain('VarLens-Web')
    expect(workflow('web-ci')).toContain('workflow_dispatch:')
    for (const name of ['checks', 'package', 'web-ci', 'docker']) {
      expect(job(build, name)).toContain('github.event.pull_request.draft != true')
    }
    expect(job(build, 'secrets-scan')).not.toContain('draft')
    expect(job(build, 'workflows')).not.toContain('draft')
    expect(job(build, 'workflows')).toContain('node scripts/ci/run.mjs --workflows')
    expect(job(build, 'changes')).toContain('node scripts/ci/changes.mjs --github-output')
    expect(job(build, 'ci')).toContain('node scripts/ci/workflow-policy.mjs aggregate')
  })

  test('ready PRs retain all platform installers and main retains coverage', () => {
    const build = workflow('build')
    for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest'])
      expect(job(build, 'package')).toContain(os)
    expect(job(build, 'package')).toContain(
      'npx electron-builder --${{ matrix.platform }} --publish never'
    )
    expect(job(build, 'checks')).toContain('make test-coverage')
    expect(job(build, 'package')).toContain('provenance.json')
    expect(workflow('release')).not.toContain('electron-vite build')
  })

  test('Node lanes install their ABI directly and verify the binary', () => {
    for (const [file, name, runtime] of [
      ['build', 'checks', 'node'],
      ['build', 'web-ci', 'node'],
      ['web-ci', 'web-ci', 'node'],
      ['publish-web', 'web-ci', 'node'],
      ['build', 'package', 'electron'],
      ['docs', 'build-screenshots', 'electron']
    ]) {
      const source = job(workflow(file), name)
      expect(source).toContain(`VARLENS_NATIVE_RUNTIME: ${runtime}`)
      expect(source).toContain(`node scripts/native/assert-native-abi.mjs ${runtime}`)
      expect(source).not.toContain('npm run rebuild:')
    }
    expect(workflow('build')).toContain('path: .cache/prettier')
    expect(workflow('build')).not.toContain('.eslintcache')
    expect(workflow('build')).not.toContain('.prettiercache')
  })

  test('hosted desktop tests receive fresh built workers while retaining the Node ABI', () => {
    const checks = job(workflow('build'), 'checks')
    const build = checks.indexOf('npm run build')
    expect(build).toBeGreaterThan(checks.indexOf('node scripts/native/assert-native-abi.mjs node'))
    expect(build).toBeLessThan(checks.indexOf('- name: Run tests'))
    expect(checks.slice(0, build)).toContain('rm -rf out/main out/preload out/renderer')
    expect(checks).toContain('test -s out/main/db-worker.js')
    expect(checks).not.toContain('rebuild:electron')
  })

  test('Docker gates use bounded builders and PR-scoped writes', () => {
    const source = job(workflow('build'), 'docker')
    expect(source).toContain('memory=6g')
    expect(source).toContain('max-parallelism = 2')
    expect(source).toContain('node scripts/ci/containers.mjs smoke varlens-web-ci')
    expect(source).toContain('node scripts/ci/containers.mjs scan varlens-web-ci')
    const cacheTo = source.split('\n').find((line) => line.includes('cache-to:'))
    expect(cacheTo).toContain("format('pr-{0}', github.event.pull_request.number)")
  })

  test('publishing tags the scanned object and verifies the registry identity', () => {
    const source = job(workflow('publish-web'), 'build-and-push')
    expect(source.match(/uses: docker\/build-push-action@/g)).toHaveLength(1)
    expect(source).toContain('version: v0.70.0')
    expect(source).toContain('severity: CRITICAL\n')
    expect(source).toContain('ignore-unfixed: true')
    expect(source).toContain('image-ref: ${{ steps.scanned.outputs.image_id }}')
    expect(source).toContain('docker tag "$SCANNED_IMAGE_ID" "$tag"')
    expect(source).toContain('"$actual_id" = "$SCANNED_IMAGE_ID"')
    expect(source).toContain('Published tags refer to different manifests')
  })

  test('docs uploads a verified capture and never falls back to tracked PNGs', () => {
    const source = workflow('docs')
    expect(source).toContain('docs-screenshots.mjs fingerprint --github-output')
    expect(source).toContain('docs-screenshots.mjs verify --fingerprint')
    expect(source).toContain("if: steps.verified.outputs.valid != 'true'")
    expect(source).toContain('docs-screenshots.mjs record --fingerprint')
    expect(source).toContain('docs-screenshots.mjs prepare --fingerprint')
    expect(source).not.toContain('path: docs/public/screenshots')
    expect(source).toContain('include-hidden-files: true')
    expect(source).toContain('vitepress build .cache/docs-site')
  })

  test('Docker context excludes unrelated files but preserves web runtime inputs', () => {
    const source = read('Dockerfile')
    expect(source).not.toContain('COPY . .')
    expect(source).toContain('COPY src/ ./src/')
    expect(source).toContain('COPY scripts/web/ ./scripts/web/')
    expect(source).toContain('target=/app/.cache/precompress')
    expect(source).toContain('postgres-import-worker.cjs')
    expect(source).toContain('await argon2.hash')
    expect(source).toContain('postgres-migrations')
    expect(read('.dockerignore')).toContain('\n**\n')
  })
})
