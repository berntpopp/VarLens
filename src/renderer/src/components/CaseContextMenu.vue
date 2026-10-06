<template>
  <!--
    Anchored to a point, not an element: `target` is the cursor position (or
    the focused item for Shift+F10 / ContextMenu key) in client coordinates.
    The connected strategy keeps the menu's top-left at that point and
    flips/shifts it to stay inside the viewport. Do not switch back to
    `location-strategy="static"` with left/top styles — Vuetify 4's static
    strategy aligns content with flexbox (bottom-center by default), which
    opened the menu far from the cursor.
  -->
  <v-menu
    ref="menuRef"
    v-model="menu.show.value"
    :target="menu.target.value"
    location="bottom start"
    origin="top start"
    @after-enter="focusFirstItem"
    @after-leave="onAfterLeave"
  >
    <v-list density="compact" role="menu" aria-label="Case actions" data-testid="case-context-menu">
      <v-list-item role="menuitem" @click="emit('edit')">
        <template #prepend>
          <v-icon :icon="mdiPencil" />
        </template>
        <v-list-item-title>Edit</v-list-item-title>
      </v-list-item>
      <v-divider />
      <v-list-item v-if="multiSelectMode" role="menuitem" @click="emit('delete-selected')">
        <template #prepend>
          <v-icon color="error" :icon="mdiDelete" />
        </template>
        <v-list-item-title>Delete {{ selectedCount }} Selected</v-list-item-title>
      </v-list-item>
      <v-list-item role="menuitem" @click="emit('delete')">
        <template #prepend>
          <v-icon :icon="mdiDelete" />
        </template>
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="multiSelectMode" role="menuitem" @click="emit('clear-selection')">
        <template #prepend>
          <v-icon :icon="mdiSelectionOff" />
        </template>
        <v-list-item-title>Clear Selection</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { mdiDelete, mdiPencil, mdiSelectionOff } from '@mdi/js'
import { useContextMenu } from '../composables/useContextMenu'

defineProps<{
  multiSelectMode: boolean
  selectedCount: number
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  'delete-selected': []
  'clear-selection': []
}>()

const menu = useContextMenu()
const menuRef = ref<{ contentEl?: HTMLElement } | null>(null)

/** Move focus into the menu so arrow keys / Enter / Escape work immediately. */
function focusFirstItem(): void {
  const first = menuRef.value?.contentEl?.querySelector<HTMLElement>('.v-list-item')
  first?.focus({ preventScroll: true })
}

function onAfterLeave(): void {
  menu.restoreFocus(menuRef.value?.contentEl)
}

defineExpose({
  open: menu.open,
  openFromKeyboard: menu.openFromKeyboard,
  close: menu.close
})
</script>
