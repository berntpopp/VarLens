<template>
  <v-dialog v-model="model" max-width="560" aria-label="Command palette">
    <!-- Swallow Tab before VAutocomplete sees it: with auto-select-first it would run the
         highlighted command. The input is the dialog's only control, so the focus trap would
         keep focus there anyway. -->
    <v-card @keydown.tab.capture.stop.prevent>
      <v-autocomplete
        ref="inputRef"
        v-model:menu="menuOpen"
        :model-value="null"
        :items="entries"
        :list-props="LIST_PROPS"
        item-title="description"
        item-value="id"
        aria-label="Run a command"
        placeholder="Run a command…"
        variant="solo"
        :prepend-inner-icon="mdiMagnify"
        hide-details
        no-data-text="No matching commands"
        auto-select-first
        @update:model-value="run"
        @keydown.esc="model = false"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps">
            <template #append>
              <kbd class="text-caption text-medium-emphasis ms-4">{{ item.key }}</kbd>
            </template>
          </v-list-item>
        </template>
      </v-autocomplete>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Ctrl/Cmd+K command palette: every listed shortcut that has a wired action,
 * shown with its key. Same list as KeyboardShortcutsDialog, same actions as the bindings.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { mdiMagnify } from '@mdi/js'
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  type ShortcutActions,
  type ShortcutId
} from '../config/keyboardShortcuts'

const props = defineProps<{ actions: ShortcutActions }>()
const model = defineModel<boolean>({ default: false })
const menuOpen = ref(false)
// Named, focusable listbox: axe flags an unnamed list and a scrollable region keyboards cannot
// reach (VAutocomplete moves real focus into options, no aria-activedescendant). Not an extra
// Tab stop: Tab is swallowed in the input above.
const LIST_PROPS: Record<string, unknown> = { 'aria-label': 'Commands', tabindex: 0 }
// Autofocus is ignored while the page already has focus: focus by hand, before the
// enter transition ends, so keys typed right after Ctrl+K are not lost.
const inputRef = ref<{ focus: () => void } | null>(null)

const ids = Object.keys(SHORTCUTS) as ShortcutId[]
const entries = computed(() =>
  SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).flatMap((shortcut) => {
    const id = ids.find((candidate) => SHORTCUTS[candidate] === shortcut)
    return id !== undefined && id !== 'palette' && props.actions[id] !== undefined
      ? [{ id, ...shortcut }]
      : []
  })
)

// The dialog has no activator, so return focus to where the user was by hand.
let returnFocusTo: HTMLElement | null = null
watch(
  model,
  (open) => {
    if (open) {
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      menuOpen.value = true
      void nextTick(() => inputRef.value?.focus())
    } else {
      returnFocusTo?.focus({ preventScroll: true })
      returnFocusTo = null
    }
  },
  { immediate: true }
)

async function run(id: ShortcutId | null): Promise<void> {
  if (id === null) return
  model.value = false
  // After focus returned, so actions that move focus (search) keep it.
  await nextTick()
  props.actions[id]?.()
}
</script>
