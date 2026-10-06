import { startGateServer } from './support/gate-server'
import {
  buildStorageState,
  GATE_STATE_PATH,
  GATE_STORAGE_STATE_PATH,
  writeJson
} from './support/gate-state'

export default async function globalSetup(): Promise<void> {
  const state = await startGateServer()
  writeJson(GATE_STATE_PATH, state)
  writeJson(GATE_STORAGE_STATE_PATH, buildStorageState(state))
}
