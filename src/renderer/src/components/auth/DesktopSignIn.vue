<script setup lang="ts">
/**
 * The full-window sign-in screen of the desktop platform sign-in (#295).
 * main.ts mounts it instead of the app while signing in is required.
 */
import { computed } from 'vue'
import { mdiAlertCircleOutline, mdiLockOutline } from '@mdi/js'

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
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
