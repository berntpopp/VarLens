import { defineConfig } from '@playwright/test'
import { gateBaseURL } from './tests/ui-gates/support/gate-server'

/**
 * UI quality gates (axe + Lighthouse) against the built web bundle.
 * Requires `out/web/` (VARLENS_WEB_BASE=/ npm run build:web) and VARLENS_PG_URL.
 * Run through `make ui-gates`; see AGENTS.md "Testing".
 */
export default defineConfig({
  testDir: './tests/ui-gates',
  testMatch: '**/*.gate.ts',
  outputDir: 'test-results/ui-gates/playwright',
  globalSetup: './tests/ui-gates/global-setup.ts',
  globalTeardown: './tests/ui-gates/global-teardown.ts',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    baseURL: gateBaseURL(),
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
