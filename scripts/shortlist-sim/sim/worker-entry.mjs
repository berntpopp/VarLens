// Worker-thread bootstrap: load the TypeScript worker through jiti (as `npx jiti` does for run.ts).
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
await jiti.import('./worker.ts')
