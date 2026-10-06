import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createToolManager } from '../../scripts/ci/tools.mjs'
import { toolCommand } from '../../scripts/ci/tool-command.mjs'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'varlens-tools-test-'))
  temporary.push(directory)
  await writeFile(join(directory, 'fixture-tool'), '#!/bin/sh\nprintf "verified tool\\n"\n')
  execFileSync('tar', ['-czf', join(directory, 'archive.tar.gz'), '-C', directory, 'fixture-tool'])
  const archive = await readFile(join(directory, 'archive.tar.gz'))
  let downloads = 0
  const manager = createToolManager({
    cacheDir: join(directory, 'cache'),
    platform: 'linux',
    arch: 'x64',
    manifest: {
      fixture: {
        version: '1.2.3',
        assets: {
          'linux-x64': {
            url: 'https://example.invalid/tool.tar.gz',
            sha256: createHash('sha256').update(archive).digest('hex'),
            executable: 'fixture-tool'
          }
        }
      }
    },
    download: async () => {
      downloads++
      return archive
    }
  })
  return { manager, directory, downloads: () => downloads }
}

describe('pinned validation tools', () => {
  it('installs verified archives outside node_modules and reuses downloads', async () => {
    const { manager, downloads } = await fixture()
    const executable = await manager.ensureTool('fixture')
    expect(isAbsolute(executable)).toBe(true)
    expect(executable).not.toContain('node_modules')
    expect(await manager.ensureTool('fixture')).toBe(executable)
    expect(downloads()).toBe(1)
    expect(execFileSync(executable, { encoding: 'utf8' })).toBe('verified tool\n')
  })

  it('repairs executable corruption from the pinned archive before fingerprinting', async () => {
    const { manager } = await fixture()
    const before = await manager.toolFingerprint()
    const executable = await manager.ensureTool('fixture')
    await writeFile(executable, '#!/bin/sh\nexit 99\n')
    expect(await manager.toolFingerprint()).toEqual(before)
    expect(execFileSync(executable, { encoding: 'utf8' })).toBe('verified tool\n')
    expect(before.fixture.executableSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a changed archive even when a binary is already cached', async () => {
    const { manager } = await fixture()
    const executable = await manager.ensureTool('fixture')
    await writeFile(join(executable, '..', 'archive'), 'untrusted bytes')
    await expect(manager.ensureTool('fixture')).rejects.toThrow(/checksum/i)
  })

  it('fails closed for unknown tooling, unsupported hosts, and failed downloads', async () => {
    const { manager } = await fixture()
    await expect(manager.ensureTool('missing')).rejects.toThrow(/unknown/i)
    const unsupported = createToolManager({ platform: 'plan9', arch: 'x64' })
    await expect(unsupported.ensureTool('actionlint')).rejects.toThrow(/unsupported/i)
    const broken = createToolManager({
      cacheDir: await mkdtemp(join(tmpdir(), 'varlens-tool-download-test-')),
      download: async () => {
        throw new Error('offline')
      }
    })
    temporary.push(broken.cacheDir)
    await expect(broken.ensureTool('actionlint')).rejects.toThrow(/offline/)
  })

  it('waits for an aborted command to exit before allowing resource cleanup', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 200)
    try {
      await expect(
        toolCommand(
          process.execPath,
          [
            '-e',
            "process.on('SIGTERM', () => { process.stdout.write('settled'); process.exit(0) }); setInterval(() => {}, 1000)"
          ],
          { signal: controller.signal }
        )
      ).rejects.toMatchObject({ stdout: Buffer.from('settled') })
    } finally {
      clearTimeout(timer)
    }
  })

  it('does not execute a download that fails its pinned checksum', async () => {
    const { directory } = await fixture()
    const manager = createToolManager({
      cacheDir: join(directory, 'bad-cache'),
      download: async () => Buffer.from('untrusted')
    })
    await expect(manager.ensureTool('actionlint')).rejects.toThrow(/checksum/i)
  })
})
