<script setup lang="ts">
/** Root of the window while the desktop platform sign-in is required (#295). */
import DesktopSignIn from './components/auth/DesktopSignIn.vue'
</script>

<template>
  <v-app>
    <v-main>
      <DesktopSignIn />
    </v-main>
  </v-app>
</template>
