<template>
  <div data-testid="ped-import-panel">
    <v-file-input
      v-model="file"
      label="PED file"
      accept=".ped,.fam,.txt"
      :prepend-icon="mdiFileUpload"
      show-size
      hide-details="auto"
      @update:model-value="readFile"
    />
    <v-alert
      v-if="errors.length"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-2"
      data-testid="ped-errors"
    >
      <div class="mb-1">Fix these lines and choose the file again:</div>
      <div v-for="e in errors" :key="`${e.line}:${e.message}`">
        Line {{ e.line }}: {{ e.message }}
      </div>
    </v-alert>
    <div v-else-if="families.length" class="d-flex ga-2 align-center mt-2">
      <v-select
        v-if="families.length > 1"
        v-model="family"
        :items="families"
        label="Family"
        hide-details
      />
      <span v-else class="text-body-2">Family {{ family }}</span>
      <v-spacer />
      <v-btn color="primary" variant="tonal" data-testid="ped-preview" @click="preview">
        Preview
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { mdiFileUpload } from '@mdi/js'
import {
  parsePed,
  pedFamilies,
  type PedError,
  type PedIndividual
} from '../../../../shared/utils/ped-parser'
import { draftFromPed, type CaseOption, type GroupDraft } from './group-draft'

const props = defineProps<{ cases: CaseOption[] }>()
const emit = defineEmits<{ preview: [draft: GroupDraft] }>()

const file = ref<File | File[] | null>(null)
const individuals = ref<PedIndividual[]>([])
const errors = ref<PedError[]>([])
const families = ref<string[]>([])
const family = ref<string | null>(null)

async function readFile(value: File | File[] | null): Promise<void> {
  const picked = Array.isArray(value) ? value[0] : value
  const result = picked ? parsePed(await picked.text()) : { individuals: [], errors: [] }
  if (picked && result.individuals.length === 0 && result.errors.length === 0) {
    result.errors.push({ line: 0, message: 'no individuals found' })
  }
  individuals.value = result.individuals
  errors.value = result.errors
  families.value = pedFamilies(result.individuals)
  family.value = families.value[0] ?? null
}

function preview(): void {
  if (family.value === null) return
  const members = individuals.value.filter((i) => i.familyId === family.value)
  emit('preview', draftFromPed(family.value, members, props.cases))
}

defineExpose({ readFile })
</script>
