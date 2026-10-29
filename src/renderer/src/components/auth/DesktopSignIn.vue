<script setup lang="ts">
/**
 * The full-window sign-in screen of the desktop platform sign-in (#295).
 * main.ts mounts it instead of the app while signing in is required; after a
 * successful sign-in the main process opens the data and reloads the window.
 */
import { computed } from 'vue'
import { mdiAlertCircleOutline, mdiLockOutline, mdiOpenInNew } from '@mdi/js'

import { useDesktopAuthStore } from '../../stores/desktopAuthStore'

const desktopAuth = useDesktopAuthStore()

const problem = computed(() =>
  desktopAuth.status.mode === 'platform' && desktopAuth.status.state === 'misconfigured'
    ? desktopAuth.status.problem
    : null
)
const issuerHost = computed(() => {
  if (desktopAuth.status.mode !== 'platform' || desktopAuth.status.state === 'misconfigured') {
    return null
  }
  try {
    return new URL(desktopAuth.status.issuer).host
  } catch {
    return desktopAuth.status.issuer
  }
})

/** What the last sign-in asks the user to do next. */
const notice = computed((): { type: 'info' | 'warning' | 'error'; text: string } | null => {
  const result = desktopAuth.lastResult
  if (result === null) return null
  switch (result.outcome) {
    case 'signed-in':
      return { type: 'info', text: 'Signed in. Opening VarLens…' }
    case 'enrolled':
      return {
        type: 'info',
        text: 'Your authenticator app is set up. Sign in once more with your password and a code.'
      }
    case 'no-access':
      return {
        type: 'warning',
        text: 'Your account may not use VarLens Desktop. Ask your administrator for access.'
      }
    case 'cancelled':
      return null
    case 'failed':
      return { type: 'error', text: result.message }
  }
})
</script>

<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card class="elevation-4" data-testid="desktop-sign-in">
          <v-card-title class="text-headline-small text-center pt-6">VarLens</v-card-title>
          <v-card-text class="pt-2">
            <v-alert
              v-if="problem"
              type="error"
              variant="tonal"
              :icon="mdiAlertCircleOutline"
              data-testid="desktop-sign-in-problem"
            >
              <div class="font-weight-medium mb-1">
                The sign-in configuration on this computer was refused.
              </div>
              <div class="text-body-medium">{{ problem }}</div>
              <div class="text-body-medium mt-2">Ask your administrator to fix it.</div>
            </v-alert>
            <div v-else class="text-center" data-testid="desktop-sign-in-required">
              <v-icon :icon="mdiLockOutline" size="40" class="mb-3" />
              <div class="text-body-large">Sign in to open your data.</div>
              <div v-if="issuerHost" class="text-body-medium text-medium-emphasis mt-1">
                You sign in at {{ issuerHost }}.
              </div>
              <v-alert
                v-if="notice"
                :type="notice.type"
                variant="tonal"
                density="compact"
                class="mt-4 text-left"
                data-testid="desktop-sign-in-notice"
              >
                {{ notice.text }}
              </v-alert>
              <div
                v-if="desktopAuth.signingIn"
                class="mt-4"
                role="status"
                data-testid="desktop-sign-in-waiting"
              >
                <v-progress-circular
                  indeterminate
                  size="24"
                  class="mb-2"
                  aria-label="Waiting for the browser"
                />
                <div class="text-body-medium">Continue in your browser.</div>
                <v-btn variant="text" class="mt-2" @click="desktopAuth.cancelSignIn()">
                  Cancel
                </v-btn>
              </div>
              <v-btn
                v-if="!desktopAuth.signingIn && desktopAuth.lastResult?.outcome === 'failed'"
                variant="text"
                class="mt-4 mr-2"
                data-testid="desktop-sign-in-cancel-other"
                @click="desktopAuth.cancelSignIn()"
              >
                Cancel a waiting sign-in
              </v-btn>
              <v-btn
                v-if="!desktopAuth.signingIn"
                color="primary"
                class="mt-4"
                :prepend-icon="mdiOpenInNew"
                data-testid="desktop-sign-in-button"
                @click="desktopAuth.signIn()"
              >
                Sign in with your browser
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
