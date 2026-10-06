// The programs that actually attach a signature. Two backends:
//
//   esigner    — SSL.com eSigner through CodeSignTool. Every call spends one
//                signature of the 20/month quota. Release only.
//   selfsigned — a throwaway self-signed certificate. Free; used to rehearse
//                the whole pipeline (real Authenticode bytes, real installer
//                re-wrap) without touching the quota. Never publishable.
//
// Backends only run the tool. Whether a signature really landed is decided by
// the caller from the bytes on disk, never from an exit code.
import { spawn } from 'node:child_process'
import { renameSync } from 'node:fs'
import process from 'node:process'

export const SIGNING_MODES = Object.freeze(['off', 'selfsigned', 'esigner'])

const ESIGNER_SECRETS = ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET']

/**
 * Reads the signing mode from the environment. Unset means `off`; any other
 * unrecognised value throws, so a typo can never degrade into "silently did
 * not sign".
 */
export function resolveSigningMode(env = process.env) {
  const raw = (env.VARLENS_WINDOWS_SIGNING ?? '').trim()
  if (raw === '') return 'off'
  if (!SIGNING_MODES.includes(raw)) {
    throw new Error(
      `VARLENS_WINDOWS_SIGNING="${raw}" is not a signing mode (expected ${SIGNING_MODES.join(', ')})`
    )
  }
  return raw
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !(env[name] ?? '').trim())
  if (missing.length > 0) {
    throw new Error(`signing is enabled but ${missing.join(', ')} is not set`)
  }
  return Object.fromEntries(names.map((name) => [name, env[name].trim()]))
}

/** Replaces every secret value in tool output before it can reach a log. */
export function redact(text, secrets) {
  let out = String(text)
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***')
  }
  return out
}

/** Runs a program without a shell and resolves with its exit code and output. */
export function runTool(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

function assertToolSucceeded(label, result, secrets = []) {
  const output = redact(result.output, secrets).trim()
  if (output) process.stdout.write(`${output}\n`)
  if (result.code !== 0) throw new Error(`${label} exited with code ${result.code}`)
}

function esignerBackend(env, run) {
  const tool = requireEnv(env, ['CST_DIR', 'CST_JAR'])
  const credentials = requireEnv(env, ESIGNER_SECRETS)
  const secrets = Object.values(credentials)
  return async (file) => {
    // CodeSignTool reads ./conf/code_sign_tool.properties relative to its CWD.
    // `sign` (not `batch_sign`): the files of a release cannot be signed in one
    // batch — the installer embeds the already-signed app and uninstaller — so
    // each call needs its own one-time password. Callers space the calls.
    const result = await run(
      'java',
      [
        '-jar',
        tool.CST_JAR,
        'sign',
        `-username=${credentials.ES_USERNAME}`,
        `-password=${credentials.ES_PASSWORD}`,
        `-credential_id=${credentials.ES_CREDENTIAL_ID}`,
        `-totp_secret=${credentials.ES_TOTP_SECRET}`,
        `-input_file_path=${file}`,
        '-override'
      ],
      { cwd: tool.CST_DIR, env }
    )
    assertToolSucceeded('CodeSignTool', result, secrets)
  }
}

const POWERSHELL_SELFSIGN = [
  "$ErrorActionPreference = 'Stop'",
  "$cert = Get-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $env:VARLENS_SELFSIGN_THUMBPRINT)",
  '$result = Set-AuthenticodeSignature -LiteralPath $env:VARLENS_SIGN_TARGET -Certificate $cert -HashAlgorithm SHA256',
  'if ($null -eq $result.SignerCertificate) { throw "no signature attached: $($result.StatusMessage)" }'
].join('; ')

function selfSignedBackend(env, run, platform) {
  if (platform === 'win32') {
    requireEnv(env, ['VARLENS_SELFSIGN_THUMBPRINT'])
    return async (file) => {
      const result = await run(
        'pwsh',
        ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SELFSIGN],
        { env: { ...env, VARLENS_SIGN_TARGET: file } }
      )
      assertToolSucceeded('Set-AuthenticodeSignature', result)
    }
  }
  const tool = requireEnv(env, ['VARLENS_SELFSIGN_OSSLSIGNCODE', 'VARLENS_SELFSIGN_PKCS12'])
  const password = env.VARLENS_SELFSIGN_PKCS12_PASSWORD ?? ''
  return async (file) => {
    const signed = `${file}.signed`
    const result = await run(
      tool.VARLENS_SELFSIGN_OSSLSIGNCODE,
      [
        'sign',
        '-pkcs12',
        tool.VARLENS_SELFSIGN_PKCS12,
        '-pass',
        password,
        '-h',
        'sha256',
        '-in',
        file,
        '-out',
        signed
      ],
      { env }
    )
    assertToolSucceeded('osslsigncode', result, [password])
    renameSync(signed, file)
  }
}

/**
 * Builds the `async (file) => void` that signs one file in place for `mode`.
 * Validates the mode's configuration up front, so a missing secret fails
 * before the first file rather than half-way through a release.
 */
export function createBackend(
  mode,
  { env = process.env, run = runTool, platform = process.platform } = {}
) {
  if (mode === 'esigner') return esignerBackend(env, run)
  if (mode === 'selfsigned') return selfSignedBackend(env, run, platform)
  throw new Error(`no signing backend for mode "${mode}"`)
}
