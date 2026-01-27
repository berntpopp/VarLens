<template>
  <v-dialog v-model="isOpen" max-width="600" persistent scrim>
    <v-card>
      <v-card-title>{{ config.title }}</v-card-title>
      <v-card-text>
        <p class="mb-4">{{ config.introduction }}</p>
        <v-list density="compact">
          <v-list-item v-for="(limitation, index) in config.limitations" :key="index" class="mb-2">
            <template #prepend>
              <v-icon :icon="limitation.icon" size="small" color="primary" class="mr-2" />
            </template>
            <v-list-item-title class="font-weight-bold">
              {{ limitation.title }}
            </v-list-item-title>
            <v-list-item-subtitle style="white-space: normal">
              {{ limitation.text }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <p class="mt-4 text-caption font-italic text-medium-emphasis">{{ config.footer }}</p>
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
import { ref } from 'vue'
import disclaimerConfig from '../config/disclaimerConfig.json'
import { useVersionGating } from '../composables/useVersionGating'

const config = disclaimerConfig
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
