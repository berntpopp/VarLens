const { defineConfig } = require('cypress')

const defaultBaseUrl = 'http://127.0.0.1:8787'
const videoSetting = process.env.VARLENS_CYPRESS_VIDEO
const resolvedLoginPasswords = new Map()
const recordVideo =
  videoSetting === undefined
    ? process.env.CI !== 'true'
    : ['1', 'true', 'yes'].includes(videoSetting.toLowerCase())

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on) {
      on('task', {
        varlensGetResolvedLoginPassword(key) {
          return resolvedLoginPasswords.get(key) ?? null
        },
        varlensSetResolvedLoginPassword({ key, password }) {
          resolvedLoginPasswords.set(key, password)
          return null
        }
      })
    },
    baseUrl: process.env.VARLENS_BASE_URL ?? defaultBaseUrl,
    specPattern: 'tests/web-smoke/**/*.cy.ts',
    supportFile: 'tests/web-smoke/support/e2e.ts',
    fixturesFolder: 'tests/web-smoke/fixtures',
    screenshotsFolder: 'tests/web-smoke/artifacts/screenshots',
    videosFolder: 'tests/web-smoke/artifacts/videos',
    video: recordVideo,
    videoCompression: 32,
    trashAssetsBeforeRuns: true,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 30000,
    env: {
      varlensUsername:
        process.env.VARLENS_USERNAME ?? process.env.VARLENS_ADMIN_USERNAME ?? 'admin',
      varlensPassword: process.env.VARLENS_PASSWORD ?? process.env.VARLENS_ADMIN_PASSWORD ?? '',
      varlensRotatedPassword:
        process.env.VARLENS_ROTATED_PASSWORD ?? process.env.VARLENS_ROTATED_ADMIN_PASSWORD ?? '',
      varlensSecondaryUsername: process.env.VARLENS_SECONDARY_USERNAME ?? '',
      varlensSecondaryPassword: process.env.VARLENS_SECONDARY_PASSWORD ?? '',
      varlensSecondaryRotatedPassword: process.env.VARLENS_SECONDARY_ROTATED_PASSWORD ?? '',
      expectedImageTag: process.env.VARLENS_EXPECTED_IMAGE_TAG ?? ''
    }
  }
})
