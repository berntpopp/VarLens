<template>
  <v-dialog
    :model-value="modelValue"
    max-width="900"
    persistent
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ editPanelId ? 'Edit Panel' : 'Create Panel' }}</span>
        <v-spacer />
        <v-btn :icon="mdiClose" variant="text" size="small" @click="close" />
      </v-card-title>

      <v-card-text>
        <!-- Panel metadata fields -->
        <v-row dense class="mb-3">
          <v-col cols="5">
            <v-text-field
              v-model="panelName"
              label="Panel Name"
              variant="outlined"
              density="compact"
              hide-details
              :rules="[nameRequired]"
            />
          </v-col>
          <v-col cols="3">
            <v-text-field
              v-model="panelVersion"
              label="Version"
              variant="outlined"
              density="compact"
              hide-details
              placeholder="e.g. 1.0"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model="panelDescription"
              label="Description"
              variant="outlined"
              density="compact"
              hide-details
            />
          </v-col>
        </v-row>

        <!-- Gene input row -->
        <div class="d-flex align-center ga-2 mb-3">
          <div class="flex-grow-1">
            <GeneAutocomplete @select="addGeneFromAutocomplete" />
          </div>
          <v-btn variant="outlined" density="compact" @click="pasteDialogOpen = true">
            Paste List
          </v-btn>
        </div>

        <!-- Gene validation table -->
        <v-table density="compact" class="gene-table">
          <thead>
            <tr>
              <th style="width: 48px">Status</th>
              <th>Symbol</th>
              <th>HGNC ID</th>
              <th>Full Name</th>
              <th>Locus</th>
              <th style="width: 120px">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="validationResults.length === 0">
              <td colspan="6" class="text-center text-medium-emphasis py-4">
                Add genes using the search above or paste a list.
              </td>
            </tr>
            <tr v-for="(result, index) in validationResults" :key="index">
              <!-- Status icon -->
              <td>
                <v-icon
                  v-if="result.status === 'approved'"
                  color="success"
                  size="small"
                  :icon="mdiCheckCircle"
                />
                <v-icon
                  v-else-if="result.status === 'alias'"
                  color="warning"
                  size="small"
                  :icon="mdiAlertCircle"
                />
                <v-icon
                  v-else-if="result.status === 'ambiguous'"
                  color="warning"
                  size="small"
                  :icon="mdiAlertCircle"
                />
                <v-icon v-else color="error" size="small" :icon="mdiCloseCircle" />
              </td>

              <!-- Symbol -->
              <td>
                <template v-if="result.status === 'approved'">
                  <span class="font-weight-bold">{{ result.symbol }}</span>
                </template>
                <template v-else-if="result.status === 'alias'">
                  <span class="text-decoration-line-through text-medium-emphasis">{{
                    result.input
                  }}</span>
                  <span class="ml-1 text-caption">
                    Alias for
                    <span class="font-weight-bold">{{ result.currentSymbol }}</span>
                  </span>
                </template>
                <template v-else-if="result.status === 'unknown'">
                  <span class="text-error">{{ result.input }}</span>
                </template>
                <template v-else>
                  {{ result.input }}
                </template>
              </td>

              <!-- HGNC ID -->
              <td>{{ result.hgncId ?? '-' }}</td>

              <!-- Full Name -->
              <td>{{ result.name ?? '-' }}</td>

              <!-- Locus -->
              <td>{{ result.locusGroup ?? '-' }}</td>

              <!-- Action -->
              <td>
                <div class="d-flex align-center ga-1">
                  <v-btn
                    v-if="result.status === 'alias'"
                    size="x-small"
                    variant="text"
                    color="primary"
                    @click="acceptAlias(index)"
                  >
                    Accept
                  </v-btn>
                  <v-select
                    v-if="result.status === 'ambiguous' && result.candidates"
                    :items="result.candidates"
                    item-title="symbol"
                    return-object
                    density="compact"
                    variant="outlined"
                    hide-details
                    placeholder="Choose..."
                    class="ambiguous-select"
                    @update:model-value="
                      (chosen: { symbol: string; hgncId: string }) =>
                        resolveAmbiguous(index, chosen)
                    "
                  />
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="error"
                    :icon="mdiClose"
                    @click="removeResult(index)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- Summary line -->
        <div v-if="validationResults.length > 0" class="text-caption mt-2">
          {{ approvedCount }} approved<template v-if="aliasCount > 0"
            >, {{ aliasCount }} alias</template
          ><template v-if="ambiguousCount > 0">, {{ ambiguousCount }} ambiguous</template
          ><template v-if="unknownCount > 0">, {{ unknownCount }} unknown</template>
        </div>
        <div v-if="validationResults.length > 0 && !canSave" class="text-caption text-warning mt-1">
          Resolve all aliases and ambiguous entries before saving.
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!panelName.trim() || !canSave"
          :loading="saving"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Paste sub-dialog -->
    <v-dialog v-model="pasteDialogOpen" max-width="500">
      <v-card>
        <v-card-title>Paste Gene List</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="pasteText"
            label="Gene symbols"
            placeholder="BRCA1&#10;BRCA2&#10;TP53&#10;ATM"
            variant="outlined"
            density="compact"
            rows="8"
            hide-details
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="pasteDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="validating" @click="validateAndAddPasted">
            Validate &amp; Add
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import GeneAutocomplete from './GeneAutocomplete.vue'
import { useGeneValidation } from '../../composables/useGeneValidation'
import { usePanelManager } from '../../composables/usePanelManager'
import { useApiService } from '../../composables/useApiService'
import type { ValidationResult } from '../../composables/useGeneValidation'
import { mdiClose, mdiCheckCircle, mdiAlertCircle, mdiCloseCircle } from '@mdi/js'
import { logService } from '../../services/LogService'

const props = defineProps<{
  modelValue: boolean
  editPanelId: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const {
  validationResults,
  validating,
  parseGeneText,
  validateSymbols,
  acceptAlias,
  removeResult,
  resolveAmbiguous,
  approvedCount,
  aliasCount,
  ambiguousCount,
  unknownCount,
  canSave,
  approvedGenes
} = useGeneValidation()

const { createPanel, updatePanel, setGenes, getGenes } = usePanelManager()
const { api } = useApiService()

const panelName = ref('')
const panelVersion = ref('')
const panelDescription = ref('')
const saving = ref(false)
const pasteDialogOpen = ref(false)
const pasteText = ref('')

const nameRequired = (v: string): boolean | string => (v && v.trim() !== '') || 'Name is required'

// Initialize when dialog opens
watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) return

    if (props.editPanelId != null) {
      // Edit mode: load existing panel metadata and genes
      if (api) {
        try {
          const panel = await api.panels.get(props.editPanelId)
          if (panel) {
            panelName.value = panel.name ?? ''
            panelVersion.value = panel.version ?? ''
            panelDescription.value = panel.description ?? ''
          }
        } catch (e) {
          logService.error(
            'Failed to load panel metadata: ' + (e instanceof Error ? e.message : String(e)),
            'panels'
          )
        }
      }
      const genes = await getGenes(props.editPanelId)
      if (genes.length > 0) {
        const symbols = genes.map((g) => g.symbol)
        await validateSymbols(symbols)
      } else {
        validationResults.value = []
      }
    } else {
      // Create mode: reset
      panelName.value = ''
      panelVersion.value = ''
      panelDescription.value = ''
      validationResults.value = []
    }
  }
)

function addGeneFromAutocomplete(payload: { symbol: string; hgncId: string; name: string }): void {
  // Deduplicate: skip if already in results
  const exists = validationResults.value.some(
    (r) => r.symbol === payload.symbol || r.input === payload.symbol
  )
  if (exists) return

  const result: ValidationResult = {
    input: payload.symbol,
    status: 'approved',
    symbol: payload.symbol,
    hgncId: payload.hgncId,
    name: payload.name
  }
  validationResults.value.push(result)
}

async function validateAndAddPasted(): Promise<void> {
  const symbols = parseGeneText(pasteText.value)
  if (symbols.length === 0) return

  // Filter out symbols already in results
  const existingSymbols = new Set(validationResults.value.map((r) => r.symbol ?? r.input))
  const newSymbols = symbols.filter((s) => !existingSymbols.has(s))
  if (newSymbols.length === 0) {
    pasteDialogOpen.value = false
    pasteText.value = ''
    return
  }

  const previousResults = validationResults.value.slice()
  const results = await validateSymbols(newSymbols)
  const combined = [...previousResults, ...results]
  const seenKeys = new Set<string>()
  const mergedResults: ValidationResult[] = []
  for (const r of combined) {
    const key = r.hgncId ?? r.symbol ?? r.input
    if (key == null || !seenKeys.has(key)) {
      if (key != null) seenKeys.add(key)
      mergedResults.push(r)
    }
  }
  validationResults.value = mergedResults

  pasteDialogOpen.value = false
  pasteText.value = ''
}

async function save(): Promise<void> {
  const name = panelName.value.trim()
  if (!name || !canSave.value) return

  saving.value = true
  try {
    let panelId: number | undefined
    if (props.editPanelId != null) {
      await updatePanel(props.editPanelId, {
        name,
        description: panelDescription.value.trim() || null,
        version: panelVersion.value.trim() || null
      })
      panelId = props.editPanelId
    } else {
      panelId = await createPanel({
        name,
        description: panelDescription.value.trim() || null,
        version: panelVersion.value.trim() || null,
        source: 'manual'
      })
    }

    if (panelId != null) {
      // Spread to plain array — Vue reactive Proxies can't be structured-cloned by Electron IPC
      await setGenes(
        panelId,
        [...approvedGenes.value].map((g) => ({ ...g }))
      )
    }

    emit('saved')
    close()
  } finally {
    saving.value = false
  }
}

function close(): void {
  pasteDialogOpen.value = false
  pasteText.value = ''
  panelName.value = ''
  panelVersion.value = ''
  panelDescription.value = ''
  validationResults.value = []
  emit('update:modelValue', false)
}
</script>

<style scoped>
.gene-table {
  max-height: 400px;
  overflow-y: auto;
}

.ambiguous-select {
  max-width: 180px;
}
</style>
