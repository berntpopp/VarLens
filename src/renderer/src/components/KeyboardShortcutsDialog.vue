<template>
  <v-dialog v-model="model" max-width="600" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" :icon="mdiKeyboard" />
        Keyboard Shortcuts
        <v-spacer />
        <v-btn aria-label="Close" icon size="small" variant="text" @click="model = false">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>

      <v-card-text>
        <div v-for="group in shortcutGroups" :key="group.title" class="mb-4">
          <div class="text-subtitle-2 mb-2">{{ group.title }}</div>
          <v-table density="compact">
            <tbody>
              <tr v-for="shortcut in group.shortcuts" :key="shortcut.description">
                <td style="width: 140px">
                  <kbd class="shortcut-key">{{ shortcut.key }}</kbd>
                </td>
                <td>{{ shortcut.description }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { mdiClose, mdiKeyboard } from '@mdi/js'
import { SHORTCUT_GROUPS as shortcutGroups } from '../config/keyboardShortcuts'
const model = defineModel<boolean>({ default: false })
</script>

<style scoped>
.shortcut-key {
  display: inline-block;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 0.85em;
  background-color: rgba(var(--v-theme-on-surface), 0.08);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 4px;
}
</style>
