// Signs one planned file, exactly once, and proves it.
//
// This is the only code path that spends eSigner quota, so it is deliberately
// strict about three things:
//
//   budget  — a ledger on disk records every signature and every attempt. One
//             signature per plan role, and a hard ceiling on attempts, so a
//             retry loop anywhere above (electron-builder has one) cannot
//             drain the monthly quota.
//   replay  — eSigner authorises each call with a TOTP, and a one-time
//             password cannot be used twice. CodeSignTool derives it from the
//             shared secret at some unknown moment during its run, so calls
//             are spaced: a call only starts in a TOTP time step strictly
//             later than the step in which the previous call *finished*.
//   proof   — success is the signature being present in the file afterwards,
//             never the tool's exit code (CodeSignTool can exit 0 unsigned).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

import { hasAuthenticodeSignature } from './pe-signature.mjs'
import { createBackend } from './signing-backends.mjs'
import { EXPECTED_SIGNATURE_COUNT, ROLES } from './signing-plan.mjs'

const TOTP_STEP_MS = 30_000
// Start a little inside the fresh step rather than on its boundary, so clock
// skew between the runner and SSL.com cannot put the call back in the old one.
const TOTP_GUARD_MS = 2_000
// One retry per release on top of the planned signatures, plus one spare.
export const MAX_SIGNING_ATTEMPTS = EXPECTED_SIGNATURE_COUNT + 2
const ATTEMPTS_PER_FILE = { esigner: 2, selfsigned: 1 }

export function readLedger(path) {
  if (!existsSync(path)) return { attempts: 0, lastTotpStep: null, signed: [] }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`)
}

function ledgerPath(env) {
  const path = (env.VARLENS_WINDOWS_SIGN_LEDGER ?? '').trim()
  if (!path) throw new Error('signing is enabled but VARLENS_WINDOWS_SIGN_LEDGER is not set')
  return path
}

/** Milliseconds to wait so a call starts in a TOTP step later than `lastStep`. */
export function totpWaitMs(lastStep, nowMs) {
  if (lastStep === null || lastStep === undefined) return 0
  const earliest = (lastStep + 1) * TOTP_STEP_MS + TOTP_GUARD_MS
  return Math.max(0, earliest - nowMs)
}

function totpStep(nowMs) {
  return Math.floor(nowMs / TOTP_STEP_MS)
}

async function attemptOnce({ file, mode, backend, ledger, path, now, sleep }) {
  if (ledger.attempts >= MAX_SIGNING_ATTEMPTS) {
    throw new Error(
      `signing budget exhausted: ${ledger.attempts} attempts already made ` +
        `(ceiling ${MAX_SIGNING_ATTEMPTS}) — refusing to spend more of the eSigner quota`
    )
  }
  if (mode === 'esigner') {
    const wait = totpWaitMs(ledger.lastTotpStep, now())
    if (wait > 0) {
      process.stdout.write(`waiting ${Math.ceil(wait / 1000)}s for a fresh TOTP step\n`)
      await sleep(wait)
    }
  }
  // Counted before the call: an attempt that dies mid-flight may still have
  // been charged, so the budget must assume it was.
  ledger.attempts += 1
  writeLedger(path, ledger)
  let failure = null
  try {
    await backend(file)
  } catch (error) {
    failure = error
  }
  ledger.lastTotpStep = totpStep(now())
  writeLedger(path, ledger)
  return failure
}

/**
 * Signs `file` for plan `role`. Resolves `'signed'` after a verified signature
 * or `'already-signed'` when this run already signed that exact file (a repeat
 * request costs nothing). Throws on anything else.
 */
export async function signFile({ file, role, mode, env = process.env, deps = {} }) {
  if (!ROLES.includes(role)) throw new Error(`unknown signing role "${role}"`)
  if (!ATTEMPTS_PER_FILE[mode]) throw new Error(`cannot sign in mode "${mode}"`)
  const { now = Date.now, sleep = delay, isSigned = hasAuthenticodeSignature } = deps
  const path = ledgerPath(env)
  const ledger = readLedger(path)
  const name = basename(file)
  const previous = ledger.signed.find((entry) => entry.role === role)

  if (isSigned(file)) {
    if (previous?.file === file) return 'already-signed'
    throw new Error(`${name} already carries a signature this run did not create — refusing it`)
  }
  if (previous) {
    throw new Error(
      `the "${role}" signature was already spent on ${basename(previous.file)} — ` +
        `signing ${name} as well would exceed the planned ${EXPECTED_SIGNATURE_COUNT} per release`
    )
  }

  const backend = deps.backend ?? createBackend(mode, { env })
  let failure = null
  for (let attempt = 1; attempt <= ATTEMPTS_PER_FILE[mode]; attempt += 1) {
    failure = await attemptOnce({ file, mode, backend, ledger, path, now, sleep })
    if (isSigned(file)) {
      ledger.signed.push({ role, file, attempt, mode })
      writeLedger(path, ledger)
      process.stdout.write(`signed ${name} (${role}, ${mode}, attempt ${attempt})\n`)
      return 'signed'
    }
    process.stdout.write(`::warning::signing attempt ${attempt} left ${name} unsigned\n`)
  }
  const reason = failure instanceof Error ? failure.message : 'the tool reported success'
  throw new Error(`${name} has no Authenticode signature after signing (${reason})`)
}
