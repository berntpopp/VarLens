<template>
  <v-dialog v-model="open" max-width="760" :persistent="busy" @update:model-value="onToggle">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        icon
        size="small"
        variant="text"
        aria-label="Manage families"
        data-testid="analysis-groups-open"
      >
        <v-icon :icon="mdiAccountGroup" />
        <v-tooltip activator="parent" location="top">Manage families / PED import</v-tooltip>
      </v-btn>
    </template>
    <v-card>
      <v-card-title class="d-flex align-center">
        <span class="text-h6">{{ editing ? editTitle : 'Families / analysis groups' }}</span>
        <v-spacer />
        <v-btn aria-label="Close" icon size="small" variant="text" @click="open = false">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <AnalysisGroupEditor
          v-if="editing"
          :key="editKey"
          :initial="editing.draft"
          :original="editing.original"
          :cases="cases"
          @saved="afterChange"
          @cancel="editing = null"
        />
        <template v-else>
          <v-list density="compact" class="py-0 mb-3" data-testid="analysis-groups-list">
            <v-list-item v-if="groups.length === 0" class="text-medium-emphasis">
              No families defined yet.
            </v-list-item>
            <v-list-item v-for="group in groups" :key="group.id" :title="group.name">
              <v-list-item-subtitle>{{ group.group_type }}</v-list-item-subtitle>
              <template #append>
                <v-btn
                  icon
                  size="x-small"
                  variant="text"
                  :aria-label="`Edit ${group.name}`"
                  @click="editGroup(group.id)"
                >
                  <v-icon size="small" :icon="mdiPencil" />
                </v-btn>
                <v-btn
                  icon
                  size="x-small"
                  variant="text"
                  color="error"
                  :aria-label="`Delete ${group.name}`"
                  @click="toDelete = group"
                >
                  <v-icon size="small" :icon="mdiDelete" />
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
          <v-btn
            color="primary"
            variant="tonal"
            :prepend-icon="mdiPlus"
            class="mb-4"
            data-testid="analysis-groups-new"
            @click="startEdit(emptyDraft(), null)"
          >
            New family
          </v-btn>
          <div class="text-caption text-medium-emphasis mb-1">Import from PED</div>
          <PedImportPanel :cases="cases" @preview="startEdit($event, null)" />
        </template>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">
          {{ error }}
        </v-alert>
      </v-card-text>
    </v-card>

    <v-dialog
      :model-value="toDelete !== null"
      max-width="340"
      @update:model-value="toDelete = null"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">Delete group?</v-card-title>
        <v-card-text>
          Delete "{{ toDelete?.name }}"? Cases and variants are kept; only the grouping is removed.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="toDelete = null">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="busy"
            data-testid="analysis-groups-confirm-delete"
            @click="deleteGroup"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiAccountGroup, mdiClose, mdiDelete, mdiPencil, mdiPlus } from '@mdi/js'
import { useApiService } from '../../composables/useApiService'
import { useAnalysisGroups } from '../../composables/useAnalysisGroups'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import type { AnalysisGroup } from '../../../../shared/types/api'
import type { AffectedStatusValue, AnalysisGroupRole } from '../../../../shared/types/database'
import { formatError } from '../../utils/ipc-result'
import AnalysisGroupEditor from './AnalysisGroupEditor.vue'
import PedImportPanel from './PedImportPanel.vue'
import { cloneDraft, type CaseOption, type GroupDraft } from './group-draft'

const emit = defineEmits<{ deleted: [groupId: number] }>()

const { api } = useApiService()
const { groups, loadGroups } = useAnalysisGroups()

const open = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const cases = ref<CaseOption[]>([])
const editing = ref<{ draft: GroupDraft; original: GroupDraft | null } | null>(null)
const editKey = ref(0)
const toDelete = ref<Pick<AnalysisGroup, 'id' | 'name'> | null>(null)

const editTitle = computed(() =>
  editing.value?.original ? `Edit ${editing.value.original.name}` : 'New family'
)

const emptyDraft = (): GroupDraft => ({ id: null, name: '', groupType: 'family', members: [] })

function startEdit(draft: GroupDraft, original: GroupDraft | null): void {
  editKey.value++
  editing.value = { draft, original }
}

async function run(action: () => Promise<void>, what: string): Promise<void> {
  if (!api) return
  busy.value = true
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = `Could not ${what}: ${formatError(err)}`
  } finally {
    busy.value = false
  }
}

async function onToggle(isOpen: boolean): Promise<void> {
  if (!isOpen) return
  editing.value = null
  await run(async () => {
    cases.value = unwrapIpcResult(await api!.cases.list()).map((c) => ({ id: c.id, name: c.name }))
    await loadGroups()
  }, 'load cases')
}

async function editGroup(id: number): Promise<void> {
  await run(async () => {
    const group = unwrapIpcResult(await api!.analysisGroups.get(id))
    const draft: GroupDraft = {
      id,
      name: group.name,
      groupType: group.group_type === 'tumor_normal' ? 'tumor_normal' : 'family',
      members: group.members.map((m) => ({
        caseId: m.case_id,
        role: m.role as AnalysisGroupRole,
        affectedStatus: m.affected_status as AffectedStatusValue,
        individualId: m.individual_id
      }))
    }
    startEdit(cloneDraft(draft), draft)
  }, 'load group')
}

async function afterChange(): Promise<void> {
  editing.value = null
  await loadGroups()
}

async function deleteGroup(): Promise<void> {
  const target = toDelete.value
  if (!target) return
  await run(async () => {
    unwrapIpcResult(await api!.analysisGroups.delete(target.id))
    toDelete.value = null
    emit('deleted', target.id)
    await loadGroups()
  }, 'delete group')
}
</script>
