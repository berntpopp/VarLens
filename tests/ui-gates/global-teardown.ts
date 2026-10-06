import { existsSync } from 'fs'
import { stopGateServer } from './support/gate-server'
import { GATE_STATE_PATH, readGateState } from './support/gate-state'

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(GATE_STATE_PATH)) return
  await stopGateServer(readGateState())
}
