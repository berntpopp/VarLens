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
    <GeneListEditorDialog
      v-model="geneListDialog"
      :gene-lists="geneLists"
      :edit-gene-list-id="editGeneListId"
      @saved="onGeneListSaved"
      @deleted="onGeneListDeleted"
    />

    <!-- Region File Import Dialog -->
    <RegionFileImportDialog v-model="regionFileDialog" @imported="onRegionFileImported" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import ExternalIdsEditor from './case-data-info/ExternalIdsEditor.vue'
import GeneListEditorDialog from './case-data-info/GeneListEditorDialog.vue'
import PrefilteringSection from './case-data-info/PrefilteringSection.vue'
import RegionFileImportDialog from './case-data-info/RegionFileImportDialog.vue'

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
const editGeneListId = ref<number | null>(null)

// Region files
const regionFiles = ref<RegionFileItem[]>([])
const selectedRegionFileId = ref<number | null>(null)
const regionFileDialog = ref(false)

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
  editGeneListId.value = selectedGeneListId.value
  geneListDialog.value = true
}

async function onGeneListSaved(payload: {
  listId: number
  geneLists: GeneListItem[]
}): Promise<void> {
  geneLists.value = payload.geneLists
  selectedGeneListId.value = payload.listId
  await save()
}

async function onGeneListDeleted(payload: { geneLists: GeneListItem[] }): Promise<void> {
  geneLists.value = payload.geneLists
  selectedGeneListId.value = null
  await save()
}

function openRegionFileImport(): void {
  regionFileDialog.value = true
}

async function onRegionFileImported(payload: {
  regionFileId: number
  regionFiles: RegionFileItem[]
}): Promise<void> {
  regionFiles.value = payload.regionFiles
  selectedRegionFileId.value = payload.regionFileId
  await save()
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
