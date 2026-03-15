<template>
  <v-dialog v-model="model" max-width="600" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-keyboard</v-icon>
        Keyboard Shortcuts
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="model = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <div v-for="group in shortcutGroups" :key="group.title" class="mb-4">
          <div class="text-subtitle-2 mb-2">{{ group.title }}</div>
          <v-table density="compact">
            <tbody>
              <tr v-for="shortcut in group.shortcuts" :key="shortcut.key">
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
/* global navigator */
const model = defineModel<boolean>({ default: false })

const isMac =
  typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toUpperCase().indexOf('MAC') >= 0
const mod = isMac ? 'Cmd' : 'Ctrl'

const shortcutGroups = [
  {
    title: 'Table Navigation',
    shortcuts: [
      { key: '\u2191 / \u2193', description: 'Move selection up / down' },
      { key: 'Enter', description: 'Open variant detail panel' },
      { key: 'Escape', description: 'Close detail panel / deselect row' }
    ]
  },
  {
    title: 'Actions (on selected row)',
    shortcuts: [
      { key: 's', description: 'Toggle star' },
      { key: 'c', description: 'Open comment dialog' },
      { key: 'a', description: 'Open ACMG classification' },
      { key: 'e', description: 'Expand / collapse row (Cohort)' }
    ]
  },
  {
    title: 'Search & Filters',
    shortcuts: [
      { key: '/', description: 'Focus search field' },
      { key: `${mod}+Shift+F`, description: 'Toggle filter panel' },
      { key: `${mod}+Shift+C`, description: 'Toggle columns panel' },
      { key: `${mod}+Shift+X`, description: 'Clear all filters' },
      { key: 'Escape', description: 'Close drawer / blur search' }
    ]
  },
  {
    title: 'General',
    shortcuts: [
      { key: '?', description: 'Show this help' },
      { key: `${mod}+L`, description: 'Toggle log viewer' },
      { key: `${mod}+Shift+D`, description: 'Show disclaimer' },
      { key: `${mod}+Shift+Q`, description: 'Show FAQ' }
    ]
  }
]
</script>

<style scoped>
.shortcut-key {
  display: inline-block;
  padding: 2px 8px;
  font-family: monospace;
  font-size: 0.85em;
  background-color: rgba(var(--v-theme-on-surface), 0.08);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 4px;
}
</style>
