import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Required jobs must finish successfully; absent selector output never authorizes a skip. */
export function evaluateHostedResults({ eventName, event = {}, needs }) {
  const errors = []
  const requireSuccess = (name) => {
    if (needs[name]?.result !== 'success')
      errors.push(`${name}: expected success, received ${needs[name]?.result ?? 'missing'}`)
  }
  for (const name of ['changes', 'secrets-scan', 'workflows']) requireSuccess(name)
  const selection = needs.changes?.outputs ?? {}
  for (const key of ['code', 'web', 'docker']) {
    if (!['true', 'false'].includes(selection[key]))
      errors.push(`Missing or invalid ${key} selection`)
    if (eventName !== 'pull_request' && selection[key] !== 'true')
      errors.push(`${eventName} must select ${key}`)
  }
  const draft = eventName === 'pull_request' && event.pull_request?.draft === true
  if (!draft) {
    if (selection.code === 'true') for (const name of ['checks', 'package']) requireSuccess(name)
    if (selection.web === 'true') requireSuccess('web-ci')
    if (selection.docker === 'true') requireSuccess('docker')
  }
  return errors
}

export function validateActionPins(source) {
  const errors = []
  for (const [index, line] of source.split('\n').entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(.*)$/)
    if (!match || match[1].startsWith('./')) continue
    if (!/^[^@]+@[a-f0-9]{40}$/.test(match[1]) || !/ #\s*[^\s]+@v[^\s]+/.test(match[2])) {
      errors.push(`line ${index + 1}: action must use a full SHA and same-line version comment`)
    }
  }
  return errors
}

function main() {
  const command = process.argv[2] ?? 'check'
  let errors
  if (command === 'aggregate') {
    errors = evaluateHostedResults({
      eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      needs: JSON.parse(process.env.NEEDS_JSON ?? '{}')
    })
  } else if (command === 'check') {
    const directory = resolve('.github/workflows')
    errors = readdirSync(directory)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        validateActionPins(readFileSync(resolve(directory, name), 'utf8')).map(
          (error) => `${name}: ${error}`
        )
      )
  } else throw new Error(`Unknown workflow-policy command: ${command}`)
  if (errors.length) throw new Error(errors.join('\n'))
  process.stdout.write('Workflow policy passed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
