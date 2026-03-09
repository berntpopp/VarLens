<template>
  <div v-if="loading" class="d-flex justify-center pa-4">
    <v-progress-circular indeterminate size="24" />
  </div>
  <div v-else>
    <!-- Import Information (read-only) -->
    <div class="text-subtitle-2 text-medium-emphasis mb-2">
      <v-icon size="small" class="mr-1">mdi-file-import-outline</v-icon>
      Import Information
    </div>
    <v-row dense class="mb-4">
      <v-col cols="6">
        <v-text-field
          :model-value="dataInfo?.import_file_name ?? 'Unknown'"
          label="Source file"
          variant="outlined"
          density="compact"
          readonly
          hide-details
        />
      </v-col>
      <v-col cols="6">
        <v-text-field
          :model-value="dataInfo?.import_file_type ?? 'Unknown'"
          label="File format"
          variant="outlined"
          density="compact"
          readonly
          hide-details
        />
      </v-col>
    </v-row>

    <!-- Platform -->
    <div class="text-subtitle-2 text-medium-emphasis mb-2">
      <v-icon size="small" class="mr-1">mdi-chip</v-icon>
      Sequencing Platform
    </div>
    <v-row dense class="mb-4">
      <v-col cols="6">
        <v-combobox
          v-model="platform"
          label="Platform"
          :items="platformSuggestions"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          placeholder="e.g. Exome, Genome, Panel"
          @update:model-value="onPlatformChange"
        />
      </v-col>
      <v-col cols="6">
        <v-text-field
          v-model="platformDetails"
          label="Platform details"
          placeholder="e.g. Twist Exome v2.0, Illumina NovaSeq"
          variant="outlined"
          density="compact"
          hide-details
          @blur="save"
        />
      </v-col>
    </v-row>

    <!-- External IDs -->
    <ExternalIdsEditor
      :external-ids="externalIds"
      :id-type-suggestions="idTypeSuggestions"
      @add="addExternalId"
      @delete="deleteExternalId"
    />

    <!-- Pre-filtering -->
    <PrefilteringSection
      v-model:af-filter="afFilter"
      v-model:quality-filter="qualityFilter"
      v-model:selected-gene-list-id="selectedGeneListId"
      v-model:selected-region-file-id="selectedRegionFileId"
      :gene-list-items="geneListItems"
      :region-file-items="regionFileItems"
      @save="save"
      @open-gene-list-editor="openGeneListEditor"
      @open-region-file-import="openRegionFileImport"
    />

    <!-- Notes -->
    <div class="text-subtitle-2 text-medium-emphasis mb-2">
      <v-icon size="small" class="mr-1">mdi-note-text-outline</v-icon>
      Data Notes
    </div>
    <v-textarea
      v-model="dataNotes"
      label="Additional notes about data provenance"
      placeholder="e.g. Reanalysis of sample X from 2024, subset of WGS data"
      variant="outlined"
      density="compact"
      hide-details
      rows="2"
      auto-grow
      @blur="save"
    />

    <!-- Gene List Editor Dialog -->
    <v-dialog v-model="geneListDialog" max-width="640" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <span>{{ editingGeneList ? 'Edit Gene List' : 'Create Gene List' }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="geneListDialog = false" />
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
          <v-btn variant="text" @click="geneListDialog = false">Cancel</v-btn>
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

    <!-- Region File Import Dialog -->
    <v-dialog v-model="regionFileDialog" max-width="500" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          <span>Import BED Region File</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="regionFileDialog = false" />
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="regionFileName"
            label="Region file name"
            variant="outlined"
            density="compact"
            class="mb-3"
            hide-details
          />
          <v-text-field
            v-model="regionFileDescription"
            label="Description (optional)"
            variant="outlined"
            density="compact"
            class="mb-3"
            hide-details
          />
          <v-btn
            variant="outlined"
            color="primary"
            prepend-icon="mdi-file-upload-outline"
            :loading="importingRegion"
            @click="selectBedFile"
          >
            {{ selectedBedPath ? 'Change file...' : 'Select BED file...' }}
          </v-btn>
          <div v-if="selectedBedPath" class="text-body-2 mt-2">
            {{ selectedBedBasename }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="regionFileDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!regionFileName.trim() || !selectedBedPath"
            :loading="importingRegion"
            @click="importRegionFile"
          >
            Import
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import ExternalIdsEditor from './case-data-info/ExternalIdsEditor.vue'
import PrefilteringSection from './case-data-info/PrefilteringSection.vue'

const props = defineProps<{
  caseId: number
}>()

interface DataInfo {
  import_file_name: string | null
  import_file_type: string | null
  platform: string | null
  platform_details: string | null
  af_filter: string | null
  gene_list_filter: string | null
  region_filter: string | null
  quality_filter: string | null
  data_notes: string | null
  gene_list_id: number | null
  region_file_id: number | null
}

interface ExternalId {
  id_type: string
  id_value: string
}

interface GeneListItem {
  id: number
  name: string
  gene_count: number
}

interface RegionFileItem {
  id: number
  name: string
  region_count: number
  total_bases: number
}

const loading = ref(true)
const dataInfo = ref<DataInfo | null>(null)
const externalIds = ref<ExternalId[]>([])

const platform = ref<string | null>(null)
const platformDetails = ref('')
const afFilter = ref('')
const qualityFilter = ref('')
const dataNotes = ref('')

// Suggestions from database
const platformSuggestions = ref<string[]>(['Exome', 'Genome', 'Targeted Panel'])
const idTypeSuggestions = ref<string[]>([])

// Gene lists
const geneLists = ref<GeneListItem[]>([])
const selectedGeneListId = ref<number | null>(null)
const geneListDialog = ref(false)
const editingGeneList = ref<number | null>(null)
const geneListName = ref('')
const geneListDescription = ref('')
const geneListGenesText = ref('')
const savingGeneList = ref(false)

// Region files
const regionFiles = ref<RegionFileItem[]>([])
const selectedRegionFileId = ref<number | null>(null)
const regionFileDialog = ref(false)
const regionFileName = ref('')
const regionFileDescription = ref('')
const selectedBedPath = ref('')
const importingRegion = ref(false)

const geneListItems = computed(() =>
  geneLists.value.map((gl) => ({
    text: `${gl.name} (${gl.gene_count} genes)`,
    value: gl.id
  }))
)

const regionFileItems = computed(() =>
  regionFiles.value.map((rf) => ({
    text: `${rf.name} (${rf.region_count} regions)`,
    value: rf.id
  }))
)

const parsedGeneCount = computed(() => {
  const genes = parseGeneText(geneListGenesText.value)
  return genes.length
})

const selectedBedBasename = computed(() => {
  if (!selectedBedPath.value) return ''
  const parts = selectedBedPath.value.split(/[/\\]/)
  return parts[parts.length - 1]
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

async function loadDataInfo(): Promise<void> {
  loading.value = true
  try {
    const api = getApi()
    const [info, ids, platforms, idTypes, gLists, rFiles] = await Promise.all([
      api.caseMetadata.getDataInfo(props.caseId),
      api.caseMetadata.listExternalIds(props.caseId),
      api.caseMetadata.distinctPlatforms(),
      api.caseMetadata.distinctExternalIdTypes(),
      api.geneLists.list(),
      api.regionFiles.list()
    ])
    dataInfo.value = info
    externalIds.value = ids ?? []

    // Merge DB platforms with defaults, deduplicated
    const defaults = ['Exome', 'Genome', 'Targeted Panel']
    const dbPlatforms = (platforms as string[]) ?? []
    const all = new Set([...defaults, ...dbPlatforms])
    platformSuggestions.value = [...all].sort()

    idTypeSuggestions.value = (idTypes as string[]) ?? []
    geneLists.value = (gLists as GeneListItem[]) ?? []
    regionFiles.value = (rFiles as RegionFileItem[]) ?? []

    if (info != null) {
      platform.value = info.platform
      platformDetails.value = info.platform_details ?? ''
      afFilter.value = info.af_filter ?? ''
      qualityFilter.value = info.quality_filter ?? ''
      dataNotes.value = info.data_notes ?? ''
      selectedGeneListId.value = info.gene_list_id
      selectedRegionFileId.value = info.region_file_id
    }
  } catch {
    // Data info table may not exist yet for old databases
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  try {
    const platformVal =
      typeof platform.value === 'string' && platform.value.trim() !== ''
        ? platform.value.trim()
        : null
    await getApi().caseMetadata.upsertDataInfo(props.caseId, {
      platform: platformVal,
      platform_details: platformDetails.value || null,
      af_filter: afFilter.value || null,
      quality_filter: qualityFilter.value || null,
      data_notes: dataNotes.value || null,
      gene_list_id: selectedGeneListId.value,
      region_file_id: selectedRegionFileId.value
    })
  } catch {
    // Silently fail - non-critical
  }
}

async function addExternalId(idType: string, idValue: string): Promise<void> {
  try {
    const api = getApi().caseMetadata
    await api.upsertExternalId(props.caseId, idType, idValue)
    const [ids, idTypes] = await Promise.all([
      api.listExternalIds(props.caseId),
      api.distinctExternalIdTypes()
    ])
    externalIds.value = ids
    idTypeSuggestions.value = idTypes ?? []
  } catch {
    // Silently fail
  }
}

async function deleteExternalId(idType: string): Promise<void> {
  try {
    await getApi().caseMetadata.deleteExternalId(props.caseId, idType)
    externalIds.value = externalIds.value.filter((e) => e.id_type !== idType)
  } catch {
    // Silently fail
  }
}

// Platform combobox: only save when a menu item is selected (not on every keystroke)
// eslint-disable-next-line no-undef
let platformDebounce: ReturnType<typeof setTimeout> | null = null
function onPlatformChange(): void {
  // Debounce to avoid saving on every keystroke; immediate save on item selection
  if (platformDebounce !== null) {
    // eslint-disable-next-line no-undef
    clearTimeout(platformDebounce)
  }
  // eslint-disable-next-line no-undef
  platformDebounce = setTimeout(() => {
    save()
    platformDebounce = null
  }, 500)
}

function openGeneListEditor(): void {
  if (selectedGeneListId.value != null) {
    // Edit existing
    const gl = geneLists.value.find((g) => g.id === selectedGeneListId.value)
    if (gl != null) {
      editingGeneList.value = gl.id
      geneListName.value = gl.name
      geneListDescription.value = ''
      // Load genes
      getApi()
        .geneLists.getGenes(gl.id)
        .then((genes: string[]) => {
          geneListGenesText.value = genes.join('\n')
        })
    }
  } else {
    // Create new
    editingGeneList.value = null
    geneListName.value = ''
    geneListDescription.value = ''
    geneListGenesText.value = ''
  }
  geneListDialog.value = true
}

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

    // Refresh lists
    geneLists.value = await api.list()
    selectedGeneListId.value = listId
    await save()
    geneListDialog.value = false
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
    geneLists.value = await getApi().geneLists.list()
    selectedGeneListId.value = null
    await save()
    geneListDialog.value = false
  } catch {
    // Silently fail
  }
}

function openRegionFileImport(): void {
  regionFileName.value = ''
  regionFileDescription.value = ''
  selectedBedPath.value = ''
  regionFileDialog.value = true
}

async function selectBedFile(): Promise<void> {
  try {
    const result = await getApi().import.selectFile()
    if (typeof result === 'string') {
      selectedBedPath.value = result
      // Auto-fill name from filename if empty
      if (regionFileName.value.trim() === '') {
        const parts = result.split(/[/\\]/)
        const basename = parts[parts.length - 1]
        regionFileName.value = basename.replace(/\.bed$/i, '')
      }
    }
  } catch {
    // Silently fail
  }
}

async function importRegionFile(): Promise<void> {
  const name = regionFileName.value.trim()
  if (name === '' || !selectedBedPath.value) return
  importingRegion.value = true
  try {
    const api = getApi().regionFiles
    const created = await api.create(name, regionFileDescription.value.trim() || null)
    await api.importBed(created.id, selectedBedPath.value)

    // Refresh lists
    regionFiles.value = await api.list()
    selectedRegionFileId.value = created.id
    await save()
    regionFileDialog.value = false
  } catch {
    // Silently fail
  } finally {
    importingRegion.value = false
  }
}

watch(() => props.caseId, loadDataInfo, { immediate: true })

onBeforeUnmount(() => {
  if (platformDebounce !== null) {
    // eslint-disable-next-line no-undef
    clearTimeout(platformDebounce)
    platformDebounce = null
  }
})
</script>
