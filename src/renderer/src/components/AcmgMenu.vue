<template>
  <v-menu offset-y :close-on-content-click="true">
    <template #activator="{ props: menuProps }">
      <slot name="activator" :props="menuProps" />
    </template>

    <v-list density="compact">
      <v-list-item
        v-for="classification in ACMG_CLASSIFICATIONS"
        :key="classification"
        :value="classification"
        @click="handleSelect(classification)"
      >
        <template #prepend>
          <v-chip :color="ACMG_COLORS[classification]" size="x-small" label class="mr-2">
            {{ ACMG_ABBREV[classification] }}
          </v-chip>
        </template>
        <v-list-item-title>{{ classification }}</v-list-item-title>
      </v-list-item>

      <!-- Clear option -->
      <v-divider />
      <v-list-item @click="handleSelect(null)">
        <v-list-item-title class="text-muted">Clear classification</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import type { AcmgClassification } from '../../../shared/config/domain.config'
import { ACMG_COLORS, ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../composables/useAnnotations'

const emit = defineEmits<{
  select: [classification: AcmgClassification | null]
}>()

const handleSelect = (classification: AcmgClassification | null) => {
  emit('select', classification)
}
</script>
