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
          aria-label="Close"
          :icon="mdiClose"
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
        <div class="text-caption text-medium-emphasis mt-1" data-testid="gene-list-count">
          {{ geneCountText }}
        </div>
        <div
          v-if="unknownSymbols.length > 0"
          class="text-caption text-error mt-1"
          role="alert"
          data-testid="gene-list-unknown"
        >
          Not recognised as HGNC gene symbols: {{ unknownSymbols.join(', ') }}. Remove or correct
          them to save.
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
          :disabled="!geneListName.trim() || unknownSymbols.length > 0"
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
import { useApiService } from '../../composables/useApiService'
import { useDebounce } from '../../composables/useDebounce'
import { mdiClose } from '@mdi/js'
import { logService } from '../../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'

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

const parsedGenes = computed(() => parseGeneText(geneListGenesText.value))
/** Symbols the gene reference does not know (validated against HGNC). */
const unknownSymbols = ref<string[]>([])
const validatedFor = ref<string | null>(null)

const geneCountText = computed(() => {
  const total = parsedGenes.value.length
  if (validatedFor.value !== parsedGenes.value.join(',')) return `${total} gene(s) entered`
  return `${total - unknownSymbols.value.length} of ${total} gene(s) recognized`
})

function parseGeneText(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((g) => g.trim().toUpperCase())
    .filter((g) => g !== '')
}

const { api } = useApiService()

/**
 * Check symbols against the bundled gene reference (same service as the
 * panel editor). Returns the unknown ones; on a lookup failure nothing is
 * flagged so an unavailable reference never blocks editing.
 */
async function findUnknownSymbols(genes: string[]): Promise<string[]> {
  if (!api || genes.length === 0) return []
  try {
    const results = unwrapIpcResult(await api.panels.validateSymbols(genes))
    return results.filter((r) => r.status === 'unknown').map((r) => r.input)
  } catch (e) {
    logService.warn(
      'Gene symbol validation failed: ' +
        (e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)),
      'gene-list'
    )
    return []
  }
}

async function validateGenes(): Promise<string[]> {
  const genes = parsedGenes.value
  const unknown = await findUnknownSymbols(genes)
  if (genes.join(',') === parsedGenes.value.join(',')) {
    unknownSymbols.value = unknown
    validatedFor.value = genes.join(',')
  }
  return unknown
}

const { debouncedFn: debouncedValidate } = useDebounce(() => void validateGenes(), 400)
watch(geneListGenesText, () => {
  unknownSymbols.value = []
  validatedFor.value = null
  debouncedValidate()
})

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
        if (api) {
          api.geneLists.getGenes(gl.id).then((result) => {
            const genes = unwrapIpcResult(result)
            geneListGenesText.value = genes.join('\n')
          })
        }
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
  if (name === '' || !api) return
  savingGeneList.value = true
  try {
    if ((await validateGenes()).length > 0) return
    const geneListsApi = api.geneLists
    let listId: number
    if (editingGeneList.value != null) {
      listId = editingGeneList.value
    } else {
      const created = unwrapIpcResult(
        await geneListsApi.create(name, geneListDescription.value.trim() || null)
      )
      listId = created.id
    }
    const genes = parseGeneText(geneListGenesText.value)
    unwrapIpcResult(await geneListsApi.setGenes(listId, genes))

    const updatedLists = unwrapIpcResult(await geneListsApi.list())
    emit('saved', { listId, geneLists: updatedLists })
    emit('update:modelValue', false)
  } catch (e) {
    logService.error(
      'Failed to save gene list: ' +
        (e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)),
      'gene-list'
    )
  } finally {
    savingGeneList.value = false
  }
}

async function deleteCurrentGeneList(): Promise<void> {
  if (editingGeneList.value == null || !api) return
  try {
    unwrapIpcResult(await api.geneLists.delete(editingGeneList.value))
    const updatedLists = unwrapIpcResult(await api.geneLists.list())
    emit('deleted', { geneLists: updatedLists })
    emit('update:modelValue', false)
  } catch (e) {
    logService.error(
      'Failed to delete gene list: ' +
        (e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)),
      'gene-list'
    )
  }
}
</script>
