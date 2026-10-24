<script setup lang="ts">
/**
 * Locks a signed-in desktop platform session (#295). Shown only then; the
 * main process reloads the window into the sign-in screen.
 */
import { computed } from 'vue'
import { mdiLockOutline } from '@mdi/js'

import IconButton from '../common/IconButton.vue'
import { useDesktopAuthStore } from '../../stores/desktopAuthStore'

const desktopAuth = useDesktopAuthStore()
const signedIn = computed(
  () => desktopAuth.status.mode === 'platform' && desktopAuth.status.state === 'signed-in'
)
</script>

<template>
  <IconButton
    v-if="signedIn"
    label="Lock VarLens"
    tooltip="Lock VarLens; sign in again to continue"
    :icon="mdiLockOutline"
    data-testid="desktop-lock"
    @click="desktopAuth.lock()"
  />
</template>
