<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    aria-label="External lookups"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <div class="d-flex justify-end pa-1">
        <IconButton
          label="Close external lookups"
          :icon="mdiClose"
          @click="emit('update:modelValue', false)"
        />
      </div>
      <ExternalLookupsSettings v-if="modelValue" />
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Admin dialog for the web server's external-lookup egress policy, opened from
 * Settings > External lookups and from the account menu.
 */
import { defineAsyncComponent } from 'vue'
import { mdiClose } from '@mdi/js'
import IconButton from '../common/IconButton.vue'

const ExternalLookupsSettings = defineAsyncComponent(() => import('./ExternalLookupsSettings.vue'))

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
