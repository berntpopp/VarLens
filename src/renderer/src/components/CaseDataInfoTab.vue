<template>
  <div v-if="loading" class="d-flex justify-center pa-4" data-testid="case-data-info-tab">
    <v-progress-circular indeterminate size="24" />
  </div>
  <div v-else data-testid="case-data-info-tab">
    <!-- Import Information (read-only) -->
    <div class="text-subtitle-2 text-medium-emphasis mb-2">
      <v-icon size="small" class="mr-1" :icon="mdiFileImportOutline" />
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
      <v-icon size="small" class="mr-1" :icon="mdiChip" />
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
      <v-icon size="small" class="mr-1" :icon="mdiNoteTextOutline" />
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
import { useQuery } from '@pinia/colada'
import ExternalIdsEditor from './case-data-info/ExternalIdsEditor.vue'
import GeneListEditorDialog from './case-data-info/GeneListEditorDialog.vue'
import PrefilteringSection from './case-data-info/PrefilteringSection.vue'
import RegionFileImportDialog from './case-data-info/RegionFileImportDialog.vue'
import { mdiChip, mdiFileImportOutline, mdiNoteTextOutline } from '@mdi/js'
import { logService } from '../services/LogService'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { caseDataInfoQuery } from '../queries/case-data-info'
import { queryApi } from '../queries/gate'
import { refetchAfterWrite } from '../queries/invalidation'
import { queryKeys } from '../queries/keys'

const props = defineProps<{
  caseId: number
}>()

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

const DEFAULT_PLATFORMS = ['Exome', 'Genome', 'Targeted Panel']

const { data: loaded, isPending: loading } = useQuery(() => caseDataInfoQuery(props.caseId))

const dataInfo = computed(() => loaded.value?.dataInfo ?? null)
const externalIds = computed(() => loaded.value?.externalIds ?? [])
const idTypeSuggestions = computed(() => loaded.value?.idTypes ?? [])
const platformSuggestions = computed(() =>
  [...new Set([...DEFAULT_PLATFORMS, ...(loaded.value?.platforms ?? [])])].sort()
)
const geneLists = computed<GeneListItem[]>(() => loaded.value?.geneLists ?? [])
const regionFiles = computed<RegionFileItem[]>(() => loaded.value?.regionFiles ?? [])

// The edit form: filled once per case from the first result, then owned by
// the user. A later refetch updates the lists above but never these fields.
const formCaseId = ref<number | null>(null)
const platform = ref<string | null>(null)
const platformDetails = ref('')
const afFilter = ref('')
const qualityFilter = ref('')
const dataNotes = ref('')
const selectedGeneListId = ref<number | null>(null)
const selectedRegionFileId = ref<number | null>(null)

const geneListDialog = ref(false)
const editGeneListId = ref<number | null>(null)
const regionFileDialog = ref(false)
/** The case a child dialog was opened for; its result is ignored for any other. */
const dialogCaseId = ref<number | null>(null)

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

let platformDebounce: ReturnType<typeof setTimeout> | null = null

function cancelPlatformDebounce(): void {
  if (platformDebounce !== null) clearTimeout(platformDebounce)
  platformDebounce = null
}

watch(
  [() => props.caseId, loaded],
  ([caseId, result], [previousCaseId]) => {
    if (caseId !== previousCaseId) {
      cancelPlatformDebounce()
      formCaseId.value = null
      geneListDialog.value = false
      editGeneListId.value = null
      regionFileDialog.value = false
      dialogCaseId.value = null
    }
    if (formCaseId.value === caseId) return
    const info = result?.dataInfo
    platform.value = info?.platform ?? null
    platformDetails.value = info?.platform_details ?? ''
    afFilter.value = info?.af_filter ?? ''
    qualityFilter.value = info?.quality_filter ?? ''
    dataNotes.value = info?.data_notes ?? ''
    selectedGeneListId.value = info?.gene_list_id ?? null
    selectedRegionFileId.value = info?.region_file_id ?? null
    if (result !== undefined) formCaseId.value = caseId
  },
  { immediate: true }
)

/** The form holds the current case's data; nothing may be written before. */
function isFormReady(caseId: number = props.caseId): boolean {
  return formCaseId.value === caseId && props.caseId === caseId
}

function warn(action: string, error: unknown): void {
  logService.warn(
    `Failed to ${action}: ${formatErrorMessage(error, 'Unknown error')}`,
    'case-data-info'
  )
}

async function save(): Promise<void> {
  const caseId = props.caseId
  if (!isFormReady(caseId)) return
  try {
    const platformVal =
      typeof platform.value === 'string' && platform.value.trim() !== ''
        ? platform.value.trim()
        : null
    unwrapIpcResult(
      await queryApi().caseMetadata.upsertDataInfo(caseId, {
        platform: platformVal,
        platform_details: platformDetails.value || null,
        af_filter: afFilter.value || null,
        quality_filter: qualityFilter.value || null,
        data_notes: dataNotes.value || null,
        gene_list_id: selectedGeneListId.value,
        region_file_id: selectedRegionFileId.value
      })
    )
  } catch (e) {
    warn('save case data info', e)
  }
}

/** Run an external-id write for the current case, then refetch its data. */
async function writeExternalId(action: string, run: (caseId: number) => Promise<unknown>) {
  const caseId = props.caseId
  if (!isFormReady(caseId)) return
  const key = queryKeys.caseDataInfo(caseId)
  try {
    unwrapIpcResult(await run(caseId))
    await refetchAfterWrite(key)
  } catch (e) {
    warn(action, e)
  }
}

function addExternalId(idType: string, idValue: string): Promise<void> {
  return writeExternalId('add external ID', (caseId) =>
    queryApi().caseMetadata.upsertExternalId(caseId, idType, idValue)
  )
}

function deleteExternalId(idType: string): Promise<void> {
  return writeExternalId('delete external ID', (caseId) =>
    queryApi().caseMetadata.deleteExternalId(caseId, idType)
  )
}

// Platform combobox: debounced, so typing does not save on every keystroke.
function onPlatformChange(): void {
  cancelPlatformDebounce()
  const caseId = props.caseId
  if (!isFormReady(caseId)) return
  platformDebounce = setTimeout(() => {
    platformDebounce = null
    if (caseId === props.caseId) void save()
  }, 500)
}

function openGeneListEditor(): void {
  if (!isFormReady()) return
  dialogCaseId.value = props.caseId
  editGeneListId.value = selectedGeneListId.value
  geneListDialog.value = true
}

function openRegionFileImport(): void {
  if (!isFormReady()) return
  dialogCaseId.value = props.caseId
  regionFileDialog.value = true
}

/**
 * A child dialog changed the gene lists or region files: reload them, apply
 * the selection it made and save. Ignored if the case changed meanwhile.
 */
async function applyDialogResult(select: () => void): Promise<void> {
  const caseId = dialogCaseId.value
  if (caseId === null || !isFormReady(caseId)) return
  dialogCaseId.value = null
  await refetchAfterWrite(queryKeys.caseDataInfo(caseId))
  if (!isFormReady(caseId)) return
  select()
  await save()
}

function onGeneListSaved(payload: { listId: number }): Promise<void> {
  return applyDialogResult(() => (selectedGeneListId.value = payload.listId))
}

function onGeneListDeleted(): Promise<void> {
  return applyDialogResult(() => (selectedGeneListId.value = null))
}

function onRegionFileImported(payload: { regionFileId: number }): Promise<void> {
  return applyDialogResult(() => (selectedRegionFileId.value = payload.regionFileId))
}

onBeforeUnmount(cancelPlatformDebounce)

// Exposed for component tests to assert loader/save/delete post-conditions
// (dataInfo/externalIds/platformSuggestions/idTypeSuggestions, plus save(),
// addExternalId(), and deleteExternalId() to drive their failure paths
// directly) without reaching into Vuetify child-component internals. No
// behavior change.
defineExpose({
  dataInfo,
  externalIds,
  platformSuggestions,
  idTypeSuggestions,
  save,
  addExternalId,
  deleteExternalId,
  openGeneListEditor,
  onGeneListSaved,
  onGeneListDeleted,
  openRegionFileImport,
  onRegionFileImported
})
</script>
