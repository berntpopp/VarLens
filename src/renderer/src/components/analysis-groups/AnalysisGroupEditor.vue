<template>
  <div data-testid="analysis-group-editor">
    <v-text-field v-model="draft.name" label="Group name" class="mb-3" hide-details="auto" />
    <div class="text-caption text-medium-emphasis mb-1">Members</div>
    <div
      v-for="(member, index) in draft.members"
      :key="index"
      class="d-flex ga-2 align-start mb-2"
      data-testid="analysis-group-member"
    >
      <v-autocomplete
        v-model="member.caseId"
        :items="caseItems"
        label="Case"
        class="flex-grow-1"
        :error-messages="
          member.caseId === null && member.individualId
            ? `No case matches PED individual ${member.individualId}`
            : undefined
        "
        :hint="member.individualId ? `PED individual ${member.individualId}` : undefined"
        persistent-hint
      />
      <v-select v-model="member.role" :items="roleItems" label="Role" style="max-width: 140px" />
      <v-select
        v-model="member.affectedStatus"
        :items="AFFECTED_STATUSES"
        label="Status"
        style="max-width: 160px"
      />
      <v-btn
        icon
        size="small"
        variant="text"
        :aria-label="`Remove member ${index + 1}`"
        @click="draft.members.splice(index, 1)"
      >
        <v-icon :icon="mdiClose" />
      </v-btn>
    </div>
    <v-btn
      variant="text"
      size="small"
      :prepend-icon="mdiPlus"
      data-testid="analysis-group-add-member"
      @click="addMember"
    >
      Add member
    </v-btn>
    <v-alert v-if="problem" type="info" variant="tonal" density="compact" class="mt-3">
      {{ problem }}
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">
      {{ error }}
    </v-alert>
    <div class="d-flex justify-end ga-2 mt-3">
      <v-btn variant="text" :disabled="saving" @click="emit('cancel')">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="problem !== null"
        :loading="saving"
        data-testid="analysis-group-save"
        @click="save"
      >
        Save
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiClose, mdiPlus } from '@mdi/js'
import { useApiService } from '../../composables/useApiService'
import { formatError } from '../../utils/ipc-result'
import {
  AFFECTED_STATUSES,
  cloneDraft,
  FAMILY_ROLES,
  TUMOR_NORMAL_ROLES,
  draftProblem,
  saveGroupDraft,
  type CaseOption,
  type GroupDraft
} from './group-draft'

const props = defineProps<{
  initial: GroupDraft
  /** Persisted state of the group being edited; null for a new group. */
  original: GroupDraft | null
  cases: CaseOption[]
}>()

const emit = defineEmits<{ saved: [groupId: number]; cancel: [] }>()

const { api } = useApiService()
const draft = ref<GroupDraft>(cloneDraft(props.initial))
const saving = ref(false)
const error = ref<string | null>(null)

const caseItems = computed(() => props.cases.map((c) => ({ title: c.name, value: c.id })))
const roleItems = computed(() =>
  draft.value.groupType === 'tumor_normal' ? TUMOR_NORMAL_ROLES : FAMILY_ROLES
)
const problem = computed(() => draftProblem(draft.value))

function addMember(): void {
  const first = draft.value.members.length === 0 || draft.value.groupType === 'tumor_normal'
  draft.value.members.push({
    caseId: null,
    role: first ? roleItems.value[0] : 'other',
    affectedStatus: 'unknown',
    individualId: null
  })
}

async function save(): Promise<void> {
  if (!api || problem.value !== null) return
  saving.value = true
  error.value = null
  try {
    emit('saved', await saveGroupDraft(api, draft.value, props.original))
  } catch (err) {
    error.value = `Could not save group: ${formatError(err)}`
  } finally {
    saving.value = false
  }
}
</script>
