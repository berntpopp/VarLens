<template>
  <v-dialog
    :model-value="modelValue"
    max-width="700"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>Import from PanelApp</span>
        <v-spacer />
        <v-btn aria-label="Close" :icon="mdiClose" variant="text" size="small" @click="close" />
      </v-card-title>

      <v-card-text>
        <!-- Search controls -->
        <v-row dense class="mb-3">
          <v-col cols="8">
            <v-text-field
              v-model="searchKeyword"
              label="Search panels..."
              variant="outlined"
              density="compact"
              hide-details
              clearable
              :prepend-inner-icon="mdiMagnify"
            />
          </v-col>
          <v-col cols="4">
            <v-btn-toggle v-model="region" mandatory density="compact" color="primary">
              <v-btn value="both" size="small">Both</v-btn>
              <v-btn value="uk" size="small">UK</v-btn>
              <v-btn value="aus" size="small">Australia</v-btn>
            </v-btn-toggle>
          </v-col>
        </v-row>

        <!-- Loading indicator -->
        <v-progress-linear v-if="searching" indeterminate color="primary" class="mb-3" />

        <!-- Search results list -->
        <v-list
          v-if="searchResults.length > 0 && !selectedPanel"
          density="compact"
          class="mb-3"
          max-height="300"
          style="overflow-y: auto"
        >
          <v-list-item
            v-for="panel in searchResults"
            :key="`${panel.region}-${panel.id}`"
            @click="selectPanel(panel)"
          >
            <v-list-item-title>{{ panel.name }}</v-list-item-title>
            <v-list-item-subtitle>
              v{{ panel.version }} - {{ panel.stats.number_of_genes }} genes
              <span v-if="panel.disease_group"> - {{ panel.disease_group }}</span>
            </v-list-item-subtitle>
            <template #append>
              <v-chip size="x-small" label :color="panel.region === 'uk' ? 'success' : 'purple'">
                {{ panel.region === 'uk' ? 'UK' : 'AUS' }}
              </v-chip>
              <v-chip
                v-if="panel.status === 'public'"
                size="x-small"
                label
                color="info"
                class="ml-1"
              >
                signed-off
              </v-chip>
            </template>
          </v-list-item>
        </v-list>

        <!-- No results message -->
        <div
          v-if="searchKeyword && !searching && searchResults.length === 0 && hasSearched"
          class="text-center text-medium-emphasis py-4"
        >
          No panels found matching "{{ searchKeyword }}".
        </div>

        <!-- Selected panel detail -->
        <v-card v-if="selectedPanel" variant="outlined" class="mb-3">
          <v-card-text>
            <div class="d-flex align-center mb-2">
              <div>
                <div class="text-subtitle-1 font-weight-bold">{{ selectedPanel.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  Version {{ selectedPanel.version }} - {{ selectedPanel.stats.number_of_genes }}
                  genes
                </div>
              </div>
              <v-spacer />
              <v-chip
                size="small"
                label
                :color="selectedPanel.region === 'uk' ? 'success' : 'purple'"
              >
                {{ selectedPanel.region === 'uk' ? 'UK' : 'AUS' }}
              </v-chip>
              <v-btn
                aria-label="Clear selected panel"
                variant="text"
                size="small"
                :icon="mdiClose"
                class="ml-1"
                @click="selectedPanel = null"
              />
            </div>

            <div class="text-body-2 mb-2">Confidence level filter:</div>
            <v-chip-group v-model="confidenceThreshold" mandatory>
              <v-chip value="green" color="success" filter> Green only </v-chip>
              <v-chip value="green_amber" color="warning" filter> Green + Amber </v-chip>
              <v-chip value="all" color="grey" filter> All </v-chip>
            </v-chip-group>
          </v-card-text>
        </v-card>

        <!-- Error alert -->
        <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-3">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn
          color="success"
          variant="flat"
          :disabled="!selectedPanel || importing"
          :loading="importing"
          @click="doImport"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { mdiClose, mdiMagnify } from '@mdi/js'
import { useApiService } from '../../composables/useApiService'
import type { PanelAppSearchResult } from '../../../../shared/types/api'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: []
}>()

const { api } = useApiService()

// Search state
const searchKeyword = ref('')
const region = ref<'uk' | 'aus' | 'both'>('both')
const searching = ref(false)
const hasSearched = ref(false)
const searchResults = ref<PanelAppSearchResult[]>([])

// Selection state
const selectedPanel = ref<PanelAppSearchResult | null>(null)
const confidenceThreshold = ref<'green' | 'green_amber' | 'all'>('green')

// Import state
const importing = ref(false)
const errorMessage = ref('')

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout> | null = null

// Clean up debounce timer on component unmount
onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
})

watch(
  [searchKeyword, region],
  () => {
    // Clear selection on new search
    selectedPanel.value = null
    errorMessage.value = ''

    if (searchTimeout) clearTimeout(searchTimeout)
    const keyword = searchKeyword.value?.trim()
    if (!keyword || keyword.length < 2) {
      searchResults.value = []
      hasSearched.value = false
      return
    }

    searchTimeout = setTimeout(() => {
      doSearch(keyword)
    }, 500)
  },
  { immediate: false }
)

// Reset state when dialog opens
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      searchKeyword.value = ''
      region.value = 'both'
      searchResults.value = []
      selectedPanel.value = null
      confidenceThreshold.value = 'green'
      errorMessage.value = ''
      hasSearched.value = false
    }
  }
)

async function doSearch(keyword: string): Promise<void> {
  if (!api) return

  searching.value = true
  errorMessage.value = ''
  try {
    searchResults.value = unwrapIpcResult(await api.panels.searchPanelApp(keyword, region.value))
    hasSearched.value = true
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function selectPanel(panel: PanelAppSearchResult): void {
  selectedPanel.value = panel
  errorMessage.value = ''
}

async function doImport(): Promise<void> {
  if (!api || !selectedPanel.value) return

  importing.value = true
  errorMessage.value = ''
  try {
    unwrapIpcResult(
      await api.panels.importPanelApp({
        panelId: selectedPanel.value.id,
        region: selectedPanel.value.region,
        confidenceThreshold: confidenceThreshold.value
      })
    )
    emit('imported')
    close()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
  } finally {
    importing.value = false
  }
}

function close(): void {
  // Always reset loading states so dialog is never stuck spinning
  searching.value = false
  importing.value = false
  errorMessage.value = ''
  emit('update:modelValue', false)
}
</script>
