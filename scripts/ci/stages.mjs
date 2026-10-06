// Ordered, explicit gate contract. Hosted-only obligations never receive a local pass.
export const GATE_MANIFEST = [
  { id: 'setup', side: 'both', lane: 'always', action: 'setup' },
  { id: 'format', side: 'both', lane: 'always', command: 'npm', args: ['run', 'format:check'] },
  { id: 'workflows', side: 'both', lane: 'always', action: 'workflows' },
  { id: 'secrets', side: 'both', lane: 'always', action: 'secrets', live: true },
  { id: 'agent-check', side: 'both', lane: 'code', command: 'make', args: ['agent-check'] },
  { id: 'quality', side: 'both', lane: 'code', action: 'quality' },
  { id: 'node', side: 'both', lane: 'code', action: 'node' },
  { id: 'postgres', side: 'local-only', lane: 'web', action: 'postgres' },
  // Worker tests need a fresh emitted bundle while the native addon is still Node ABI.
  {
    id: 'desktop-build',
    side: 'both',
    lane: 'electron',
    command: 'npm',
    args: ['run', 'build'],
    outputs: ['out/main', 'out/preload', 'out/renderer'],
    requiredFiles: ['out/main/db-worker.js'],
    clean: ['out/main', 'out/preload', 'out/renderer']
  },
  {
    id: 'desktop-tests',
    side: 'both',
    lane: 'code',
    command: 'npx',
    args: [
      '--no-install',
      'vitest',
      'run',
      '--project',
      'main',
      '--project',
      'renderer',
      '--coverage'
    ],
    env: { COVERAGE: '1' }
  },
  {
    id: 'web-build',
    side: 'both',
    lane: 'web',
    command: 'npm',
    args: ['run', 'build:web'],
    outputs: ['out/web'],
    clean: ['out/web']
  },
  { id: 'web-static', side: 'both', lane: 'web', command: 'make', args: ['web-gate-static'] },
  {
    id: 'postgres-tests',
    side: 'both',
    lane: 'web',
    command: 'make',
    args: ['web-gate-integration']
  },
  { id: 'postgres-storage', side: 'both', lane: 'web', action: 'postgres-storage' },
  { id: 'docker', side: 'both', lane: 'docker', action: 'docker', live: true },
  { id: 'release-contracts', side: 'both', lane: 'code', action: 'release-contracts' },
  { id: 'electron', side: 'both', lane: 'electron', action: 'electron' },
  { id: 'startup', side: 'both', lane: 'electron', action: 'startup' },
  {
    id: 'package',
    side: 'both',
    lane: 'code',
    command: 'npx',
    args: ['--no-install', 'electron-builder', '--publish', 'never'],
    outputs: ['release'],
    clean: ['release']
  },
  { id: 'artifacts', side: 'both', lane: 'code', action: 'artifacts' },
  { id: 'packaged-smoke', side: 'both', lane: 'linux-package', action: 'packaged-smoke' },
  { id: 'screenshots', side: 'both', lane: 'capture', action: 'screenshots' },
  {
    id: 'docs',
    side: 'both',
    lane: 'docs',
    action: 'docs',
    outputs: ['.cache/docs-site/.vitepress/dist']
  },
  { id: 'other-platform-installers', side: 'hosted-only', lane: 'code' },
  { id: 'merge-result', side: 'hosted-only', lane: 'code' },
  { id: 'signing-and-publication', side: 'hosted-only', lane: 'code' }
]
export function selectStages(
  selection,
  { platform = process.platform, screenshotsMissing = false } = {}
) {
  const capture = selection.docs && (selection.screenshots || screenshotsMissing)
  const lanes = {
    ...selection,
    always: true,
    electron: selection.code || capture,
    capture,
    'linux-package': selection.code && platform === 'linux'
  }
  return GATE_MANIFEST.filter((gate) => gate.side !== 'hosted-only' && lanes[gate.lane])
}
export async function executeStages(stages, executor, { signal, onResult = () => {} } = {}) {
  const results = []
  for (const stage of stages) {
    signal?.throwIfAborted()
    const start = Date.now()
    try {
      await executor(stage)
      signal?.throwIfAborted()
      const result = { id: stage.id, status: 'passed', durationMs: Date.now() - start }
      results.push(result)
      onResult(result)
    } catch (error) {
      onResult({ id: stage.id, status: 'failed', durationMs: Date.now() - start })
      throw error
    }
  }
  return results
}
