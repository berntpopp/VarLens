<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span class="text-h6">Manage Presets</span>
        <v-spacer />
        <v-btn
          aria-label="Close"
          icon
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        >
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-list density="compact" class="py-0">
        <v-list-item
          v-for="preset in presets"
          :key="preset.id"
          :class="{ 'bg-grey-lighten-4': !preset.isVisible }"
        >
          <template #prepend>
            <v-icon v-if="preset.isBuiltIn" size="small" class="mr-2" :icon="mdiLock" />
            <v-icon v-else size="small" class="mr-2" :icon="mdiAccount" />
          </template>

          <v-list-item-title :class="{ 'text-medium-emphasis': !preset.isVisible }">
            {{ preset.name }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="preset.description" class="text-caption">
            {{ preset.description }}
          </v-list-item-subtitle>

          <template #append>
            <!-- Toggle visibility -->
            <v-btn
              :aria-label="preset.isVisible ? 'Hide preset' : 'Show preset'"
              icon
              size="x-small"
              variant="text"
              @click="emit('toggle-visibility', preset.id, !preset.isVisible)"
            >
              <v-icon size="small" :icon="preset.isVisible ? mdiEye : mdiEyeOff" />
              <v-tooltip activator="parent" location="bottom">
                {{ preset.isVisible ? 'Hide from toolbar' : 'Show in toolbar' }}
              </v-tooltip>
            </v-btn>

            <!-- Delete (user presets only) -->
            <v-btn
              v-if="!preset.isBuiltIn"
              aria-label="Delete preset"
              icon
              size="x-small"
              variant="text"
              color="error"
              @click="confirmDelete(preset)"
            >
              <v-icon size="small" :icon="mdiDelete" />
              <v-tooltip activator="parent" location="bottom">Delete preset</v-tooltip>
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <!-- Delete confirmation -->
      <v-dialog v-model="showDeleteConfirm" max-width="300">
        <v-card>
          <v-card-title class="text-subtitle-1">Delete preset?</v-card-title>
          <v-card-text> Are you sure you want to delete "{{ presetToDelete?.name }}"? </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="showDeleteConfirm = false">Cancel</v-btn>
            <v-btn color="error" variant="flat" @click="doDelete">Delete</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { FilterPreset } from '../../../shared/types/filter-presets'
import { mdiAccount, mdiClose, mdiDelete, mdiEye, mdiEyeOff, mdiLock } from '@mdi/js'

defineProps<{
  modelValue: boolean
  presets: FilterPreset[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'toggle-visibility': [id: number, visible: boolean]
  delete: [id: number]
}>()

const showDeleteConfirm = ref(false)
const presetToDelete = ref<FilterPreset | null>(null)

function confirmDelete(preset: FilterPreset): void {
  presetToDelete.value = preset
  showDeleteConfirm.value = true
}

function doDelete(): void {
  if (presetToDelete.value) {
    emit('delete', presetToDelete.value.id)
  }
  showDeleteConfirm.value = false
  presetToDelete.value = null
}
</script>
