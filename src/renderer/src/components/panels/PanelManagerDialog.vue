<template>
  <v-dialog
    :model-value="modelValue"
    max-width="800"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card min-height="450">
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiPlaylistEdit" class="mr-2" />
        <span>Gene Panels</span>
        <v-spacer />
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-toolbar density="compact" color="transparent" class="px-2">
        <v-text-field
          v-model="searchQuery"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          placeholder="Search panels..."
          :prepend-inner-icon="mdiMagnify"
          class="mr-3"
          style="max-width: 320px"
        />
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          density="comfortable"
          size="small"
          :prepend-icon="mdiPlus"
          @click="openCreate"
        >
          New Panel
        </v-btn>
        <v-btn
          color="primary"
          variant="outlined"
          density="comfortable"
          size="small"
          class="ml-2"
          :prepend-icon="mdiDownload"
          @click="panelAppImportOpen = true"
        >
          Import PanelApp
        </v-btn>
        <v-btn
          color="primary"
          variant="outlined"
          density="comfortable"
          size="small"
          class="ml-2"
          :prepend-icon="mdiShareVariant"
          @click="stringDbGenerateOpen = true"
        >
          StringDB Generate
        </v-btn>
      </v-toolbar>

      <v-card-text class="pa-0">
        <v-table hover density="compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Source</th>
              <th>Genes</th>
              <th>Created</th>
              <th style="width: 180px">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredPanels.length === 0">
              <td colspan="6" class="text-center text-medium-emphasis py-6">
                {{
                  panels.length === 0
                    ? 'No panels yet. Create one to get started.'
                    : 'No panels match your search.'
                }}
              </td>
            </tr>
            <tr v-for="panel in filteredPanels" :key="panel.id">
              <td>
                <span class="font-weight-bold">{{ panel.name }}</span>
                <div v-if="panel.description" class="text-caption text-medium-emphasis">
                  {{ panel.description }}
                </div>
              </td>
              <td>{{ panel.version ?? '-' }}</td>
              <td>
                <v-chip size="x-small" label :color="sourceColor(panel.source)">
                  {{ panel.source }}
                </v-chip>
              </td>
              <td>{{ panel.gene_count }}</td>
              <td>{{ formatDate(panel.created_at) }}</td>
              <td>
                <div class="d-flex ga-1">
                  <v-btn
                    size="small"
                    variant="text"
                    color="primary"
                    :icon="mdiPencil"
                    @click="openEdit(panel.id)"
                  >
                    <v-icon :icon="mdiPencil" />
                    <v-tooltip activator="parent" location="top">Edit</v-tooltip>
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    :icon="mdiContentCopy"
                    @click="duplicate(panel)"
                  >
                    <v-icon :icon="mdiContentCopy" />
                    <v-tooltip activator="parent" location="top">Copy</v-tooltip>
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    color="info"
                    :icon="mdiExport"
                    @click="exportBed(panel)"
                  >
                    <v-icon :icon="mdiExport" />
                    <v-tooltip activator="parent" location="top">Export</v-tooltip>
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    color="error"
                    :icon="mdiDelete"
                    @click="confirmDelete(panel)"
                  >
                    <v-icon :icon="mdiDelete" />
                    <v-tooltip activator="parent" location="top">Delete</v-tooltip>
                  </v-btn>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>

      <!-- Gene Reference DB info footer -->
      <div
        v-if="geneRefInfo"
        class="d-flex align-center justify-space-between pa-3 bg-grey-lighten-4"
      >
        <span class="text-caption text-medium-emphasis">
          Gene Reference: {{ geneRefInfo.geneCount.toLocaleString() }} genes &middot;
          {{ geneRefInfo.assemblies.join('/') }} &middot; Built
          {{ formatDate(geneRefInfo.builtAt * 1000) }}
        </span>
        <v-btn
          size="x-small"
          variant="text"
          color="primary"
          :loading="geneRefUpdating"
          @click="updateGeneRef"
        >
          Update
        </v-btn>
      </div>
    </v-card>

    <!-- Panel editor sub-dialog -->
    <PanelEditorDialog v-model="editorOpen" :edit-panel-id="editingPanelId" @saved="onPanelSaved" />

    <!-- Delete confirmation sub-dialog -->
    <v-dialog v-model="deleteDialogOpen" max-width="400">
      <v-card>
        <v-card-title>Delete Panel</v-card-title>
        <v-card-text>
          Are you sure you want to delete
          <strong>{{ deletingPanel?.name }}</strong
          >? This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialogOpen = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- PanelApp import sub-dialog -->
    <PanelAppImportDialog v-model="panelAppImportOpen" @imported="onExternalImport" />

    <!-- StringDB generate sub-dialog -->
    <StringDbGenerateDialog v-model="stringDbGenerateOpen" @generated="onExternalImport" />

    <!-- BED Export options sub-dialog -->
    <v-dialog v-model="exportAssemblyDialogOpen" max-width="400">
      <v-card>
        <v-card-title>Export BED File</v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-4">
            Export <strong>{{ exportingPanel?.name }}</strong> as a BED file.
          </p>
          <v-select
            v-model="exportAssembly"
            :items="['GRCh37', 'GRCh38']"
            label="Assembly"
            variant="outlined"
            density="compact"
            class="mb-3"
          />
          <v-text-field
            v-model.number="exportPadding"
            label="Padding (bp)"
            type="number"
            variant="outlined"
            density="compact"
            :min="0"
            hint="Base pairs to add around each gene region"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="exportAssemblyDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="doExportBed">Export</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Error snackbar -->
    <v-snackbar v-model="errorSnackbar" color="error" :timeout="6000" location="bottom">
      {{ errorSnackbarText }}
      <template #actions>
        <v-btn variant="text" @click="errorSnackbar = false">Close</v-btn>
      </template>
    </v-snackbar>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import PanelEditorDialog from './PanelEditorDialog.vue'
import PanelAppImportDialog from './PanelAppImportDialog.vue'
import StringDbGenerateDialog from './StringDbGenerateDialog.vue'
import { usePanelManager } from '../../composables/usePanelManager'
import type { PanelListItem } from '../../composables/usePanelManager'
import { useApiService } from '../../composables/useApiService'
import {
  mdiClose,
  mdiContentCopy,
  mdiDelete,
  mdiDownload,
  mdiExport,
  mdiMagnify,
  mdiPencil,
  mdiPlaylistEdit,
  mdiPlus,
  mdiShareVariant
} from '@mdi/js'
import type { GeneRefInfo } from '../../../../shared/types/api'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  panelsChanged: []
}>()

const { panels, loadPanels, duplicatePanel, deletePanel } = usePanelManager()
const { api } = useApiService()

const searchQuery = ref('')
const editorOpen = ref(false)
const editingPanelId = ref<number | null>(null)
const deleteDialogOpen = ref(false)
const deletingPanel = ref<PanelListItem | null>(null)
const panelAppImportOpen = ref(false)
const stringDbGenerateOpen = ref(false)
const geneRefInfo = ref<GeneRefInfo | null>(null)
const geneRefUpdating = ref(false)
const errorSnackbar = ref(false)
const errorSnackbarText = ref('')
const exportAssemblyDialogOpen = ref(false)
const exportingPanel = ref<PanelListItem | null>(null)
const exportAssembly = ref('GRCh38')
const exportPadding = ref(0)

// Load panels and gene ref info when dialog opens (immediate to catch first open)
watch(
  () => props.modelValue,
  async (visible) => {
    if (visible) {
      await loadPanels()
      try {
        geneRefInfo.value = (await api?.geneRef.info()) ?? null
      } catch {
        // silently ignore - info bar won't show
      }
    }
  },
  { immediate: true }
)

const filteredPanels = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return panels.value
  return panels.value.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.description?.toLowerCase().includes(query) ?? false) ||
      p.source.toLowerCase().includes(query)
  )
})

function sourceColor(source: string): string {
  const colors: Record<string, string> = {
    manual: 'primary',
    panelapp_uk: 'success',
    panelapp_aus: 'purple',
    stringdb: 'orange',
    bed_import: 'grey'
  }
  return colors[source] ?? 'grey'
}

function formatDate(dateStr: string | number): string {
  try {
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return String(dateStr)
  }
}

function openCreate(): void {
  editingPanelId.value = null
  editorOpen.value = true
}

function openEdit(id: number): void {
  editingPanelId.value = id
  editorOpen.value = true
}

async function duplicate(panel: PanelListItem): Promise<void> {
  await duplicatePanel(panel.id, panel.name + ' (copy)')
  emit('panelsChanged')
}

function confirmDelete(panel: PanelListItem): void {
  deletingPanel.value = panel
  deleteDialogOpen.value = true
}

async function doDelete(): Promise<void> {
  if (!deletingPanel.value) return
  await deletePanel(deletingPanel.value.id)
  deleteDialogOpen.value = false
  deletingPanel.value = null
  emit('panelsChanged')
}

function onPanelSaved(): void {
  loadPanels()
  emit('panelsChanged')
}

function onExternalImport(): void {
  loadPanels()
  emit('panelsChanged')
}

async function updateGeneRef(): Promise<void> {
  geneRefUpdating.value = true
  try {
    const result = await api?.geneRef.update()
    if (result?.success === true) {
      geneRefInfo.value = (await api?.geneRef.info()) ?? null
    } else {
      errorSnackbarText.value = result?.message ?? 'API not available'
      errorSnackbar.value = true
    }
  } catch (e) {
    errorSnackbarText.value = e instanceof Error ? e.message : String(e)
    errorSnackbar.value = true
  } finally {
    geneRefUpdating.value = false
  }
}

function exportBed(panel: PanelListItem): void {
  exportingPanel.value = panel
  exportAssembly.value = 'GRCh38'
  exportPadding.value = 0
  exportAssemblyDialogOpen.value = true
}

async function doExportBed(): Promise<void> {
  if (!exportingPanel.value) return
  try {
    await api?.panels.exportBed(exportingPanel.value.id, exportAssembly.value, exportPadding.value)
  } catch (e) {
    errorSnackbarText.value = e instanceof Error ? e.message : String(e)
    errorSnackbar.value = true
  }
  exportAssemblyDialogOpen.value = false
  exportingPanel.value = null
}
</script>
