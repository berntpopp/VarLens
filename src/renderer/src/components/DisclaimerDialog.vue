<template>
  <v-dialog
    v-model="isOpen"
    max-width="700"
    persistent
    scrim
    aria-labelledby="disclaimer-dialog-title"
  >
    <v-card>
      <v-card-title id="disclaimer-dialog-title">{{ config.title }}</v-card-title>
      <v-card-text style="max-height: 70vh; overflow-y: auto">
        <p class="mb-4">{{ config.introduction }}</p>
        <div
          v-for="(limitation, index) in config.limitations"
          :key="index"
          class="limitation-item d-flex mb-3 pa-3 rounded"
        >
          <v-icon
            :icon="limitation.icon"
            size="small"
            color="primary"
            class="mr-3 mt-1 flex-shrink-0"
          />
          <div>
            <div class="text-body-2 font-weight-bold mb-1">{{ limitation.title }}</div>
            <div class="text-body-2 text-high-emphasis">{{ limitation.text }}</div>
          </div>
        </div>
        <p class="mt-4 text-body-small font-italic text-high-emphasis">{{ config.footer }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="handleAcknowledge">
          {{ config.acknowledgeButtonText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  mdiAccountOffOutline,
  mdiAlertCircleOutline,
  mdiFlaskOutline,
  mdiSchoolOutline,
  mdiShieldCheckOutline
} from '@mdi/js'
import disclaimerConfig from '../config/disclaimerConfig.json'
import { useVersionGating } from '../composables/useVersionGating'

const iconMap: Record<string, string> = {
  'mdi-flask-outline': mdiFlaskOutline,
  'mdi-shield-check-outline': mdiShieldCheckOutline,
  'mdi-account-off-outline': mdiAccountOffOutline,
  'mdi-alert-circle-outline': mdiAlertCircleOutline,
  'mdi-school-outline': mdiSchoolOutline
}

const config = computed(() => ({
  ...disclaimerConfig,
  limitations: disclaimerConfig.limitations.map((l) => ({
    ...l,
    icon: iconMap[l.icon] || l.icon
  }))
}))
const isOpen = ref(false)

const { needsAcknowledgment, recordAcknowledgment } = useVersionGating()

const emit = defineEmits<{
  acknowledged: []
}>()

const handleAcknowledge = (): void => {
  recordAcknowledgment()
  isOpen.value = false
  emit('acknowledged')
}

const checkAndShow = (): void => {
  if (needsAcknowledgment()) {
    isOpen.value = true
  }
}

const show = (): void => {
  isOpen.value = true
}

defineExpose({ checkAndShow, show })
</script>

<style scoped>
.limitation-item {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 4%, transparent);
  border: 1px solid rgba(var(--v-border-color), 0.12);
}
</style>
