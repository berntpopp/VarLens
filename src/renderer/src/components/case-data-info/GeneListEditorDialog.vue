<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ editingGeneList ? 'Edit Gene List' : 'Create Gene List' }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          @click="$emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="geneListName"
          label="List name"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />
        <v-text-field
          v-model="geneListDescription"
          label="Description (optional)"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />
        <v-textarea
          v-model="geneListGenesText"
          label="Genes (one per line, or comma/semicolon separated)"
          placeholder="BRCA1&#10;BRCA2&#10;TP53&#10;ATM"
          variant="outlined"
          density="compact"
          rows="8"
          hide-details
        />
        <div class="text-caption text-medium-emphasis mt-1">
          {{ parsedGeneCount }} gene(s) recognized
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn v-if="editingGeneList" color="error" variant="text" @click="deleteCurrentGeneList">
          Delete list
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!geneListName.trim()"
          :loading="savingGeneList"
          @click="saveGeneList"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface GeneListItem {
  id: number
  name: string
  gene_count: number
}

const props = defineProps<{
  modelValue: boolean
  geneLists: GeneListItem[]
  editGeneListId: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [payload: { listId: number; geneLists: GeneListItem[] }]
  deleted: [payload: { geneLists: GeneListItem[] }]
}>()

const editingGeneList = ref<number | null>(null)
const geneListName = ref('')
const geneListDescription = ref('')
const geneListGenesText = ref('')
const savingGeneList = ref(false)

const parsedGeneCount = computed(() => {
  return parseGeneText(geneListGenesText.value).length
})

function parseGeneText(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((g) => g.trim().toUpperCase())
    .filter((g) => g !== '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getApi(): any {
  // eslint-disable-next-line no-undef
  return (window as unknown as Record<string, unknown>).api
}

// Initialize dialog state when opened
watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    if (props.editGeneListId != null) {
      const gl = props.geneLists.find((g) => g.id === props.editGeneListId)
      if (gl != null) {
        editingGeneList.value = gl.id
        geneListName.value = gl.name
        geneListDescription.value = ''
        getApi()
          .geneLists.getGenes(gl.id)
          .then((genes: string[]) => {
            geneListGenesText.value = genes.join('\n')
          })
      }
    } else {
      editingGeneList.value = null
      geneListName.value = ''
      geneListDescription.value = ''
      geneListGenesText.value = ''
    }
  }
)

async function saveGeneList(): Promise<void> {
  const name = geneListName.value.trim()
  if (name === '') return
  savingGeneList.value = true
  try {
    const api = getApi().geneLists
    let listId: number
    if (editingGeneList.value != null) {
      listId = editingGeneList.value
    } else {
      const created = await api.create(name, geneListDescription.value.trim() || null)
      listId = created.id
    }
    const genes = parseGeneText(geneListGenesText.value)
    await api.setGenes(listId, genes)

    const updatedLists = await api.list()
    emit('saved', { listId, geneLists: updatedLists })
    emit('update:modelValue', false)
  } catch {
    // Silently fail
  } finally {
    savingGeneList.value = false
  }
}

async function deleteCurrentGeneList(): Promise<void> {
  if (editingGeneList.value == null) return
  try {
    await getApi().geneLists.delete(editingGeneList.value)
    const updatedLists = await getApi().geneLists.list()
    emit('deleted', { geneLists: updatedLists })
    emit('update:modelValue', false)
  } catch {
    // Silently fail
  }
}
</script>
