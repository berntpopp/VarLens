import { createHash } from 'node:crypto'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { arch, platform, release } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MANIFEST = 'capture-manifest.json'
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const INPUTS = [
  'src',
  'resources',
  'tests/e2e',
  'scripts/native',
  'scripts/ci/docs-screenshots.mjs',
  '.github/workflows/docs.yml',
  'Makefile',
  'package.json',
  'package-lock.json',
  '.nvmrc',
  'electron.vite.config.ts',
  'playwright.config.ts'
]
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

function filesUnder(root, relative) {
  const absolute = join(root, relative)
  if (!existsSync(absolute)) return []
  const children = readdirSync(absolute, { withFileTypes: true })
  return children.flatMap((child) =>
    child.isDirectory()
      ? filesUnder(root, join(relative, child.name))
      : child.isFile()
        ? [join(relative, child.name)]
        : []
  )
}

/** Host identity is deliberate: Linux captures cannot certify macOS rendering. */
export function screenshotFingerprint({
  root = process.cwd(),
  identity = `${platform()}/${arch()}/${release()}/${process.version}/${process.env.ImageOS ?? 'local'}/${process.env.ImageVersion ?? 'local'}`
} = {}) {
  const paths = INPUTS.flatMap((input) => {
    if (!existsSync(join(root, input))) return []
    return ['src', 'resources', 'tests/e2e', 'scripts/native'].includes(input)
      ? filesUnder(root, input)
      : [input]
  })
  paths.push(...readdirSync(root).filter((name) => /^tsconfig.*\.json$/.test(name)))
  return hash(
    JSON.stringify({
      schema: 1,
      identity,
      inputs: paths.sort().map((path) => [path, hash(readFileSync(join(root, path)))])
    })
  )
}

function expectedScreenshots(root) {
  const source = readFileSync(join(root, 'tests/e2e/screenshots.e2e.ts'), 'utf8')
  const declaration = source.match(/const EXPECTED_SCREENSHOTS = \[([\s\S]*?)\] as const/)
  if (!declaration) throw new Error('Screenshot capture manifest is missing')
  const names = [...declaration[1].matchAll(/'([a-z0-9-]+)'/g)].map((match) => `${match[1]}.png`)
  if (!names.length) throw new Error('Screenshot capture manifest is empty')
  return names.sort()
}

function captureDigests(root, directory) {
  return Object.fromEntries(
    expectedScreenshots(root).map((name) => {
      const bytes = readFileSync(join(directory, name))
      if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE))
        throw new Error(`Invalid screenshot: ${name}`)
      return [name, hash(bytes)]
    })
  )
}

export function verifyScreenshots({ root = process.cwd(), directory, fingerprint }) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, MANIFEST), 'utf8'))
    return (
      manifest.schema === 1 &&
      manifest.fingerprint === fingerprint &&
      JSON.stringify(manifest.files) === JSON.stringify(captureDigests(root, directory))
    )
  } catch {
    return false
  }
}

export function recordScreenshots({ root = process.cwd(), directory, fingerprint }) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid screenshot fingerprint')
  const files = captureDigests(root, directory)
  writeFileSync(
    join(directory, MANIFEST),
    `${JSON.stringify({ schema: 1, fingerprint, files }, null, 2)}\n`
  )
}

export function prepareDocs({
  root = process.cwd(),
  directory,
  fingerprint,
  destination = join(root, '.cache/docs-site')
}) {
  if (!verifyScreenshots({ root, directory, fingerprint }))
    throw new Error('A verified screenshot capture is required; recapture before building docs')
  const target = resolve(root, destination)
  const withinCache = relative(resolve(root, '.cache'), target)
  if (
    !withinCache ||
    withinCache.startsWith(`..${sep}`) ||
    withinCache === '..' ||
    isAbsolute(withinCache)
  ) {
    throw new Error('Docs preparation destination must be inside the repository .cache directory')
  }
  rmSync(target, { recursive: true, force: true })
  cpSync(join(root, 'docs'), target, {
    recursive: true,
    filter: (path) =>
      !/(?:^|[/\\])(?:node_modules|\.cache|dist)(?:[/\\]|$)/.test(
        relative(join(root, 'docs'), path)
      )
  })
  const screenshots = join(target, 'public/screenshots')
  rmSync(screenshots, { recursive: true, force: true })
  mkdirSync(screenshots, { recursive: true })
  for (const name of expectedScreenshots(root))
    cpSync(join(directory, name), join(screenshots, name))
  return target
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  const option = (name) => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const fingerprint = option('--fingerprint') ?? screenshotFingerprint()
  const directory = resolve(option('--directory') ?? '.cache/docs-screenshots/capture')
  const input = { directory, fingerprint }
  const output = (name, value) => {
    process.stdout.write(`${name}=${value}\n`)
    if (args.includes('--github-output'))
      appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
  }
  if (command === 'fingerprint') output('fingerprint', fingerprint)
  else if (command === 'verify') output('valid', verifyScreenshots(input))
  else if (command === 'record') recordScreenshots(input)
  else if (command === 'prepare')
    output('destination', prepareDocs({ ...input, destination: option('--destination') }))
  else throw new Error(`Unknown docs-screenshots command: ${command}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
