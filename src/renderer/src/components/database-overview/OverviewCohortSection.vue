<template>
  <div class="mb-4">
    <div
      class="text-title-small mb-2 d-flex align-center cursor-pointer"
      @click="expanded = !expanded"
    >
      <v-icon size="small" class="mr-1" :icon="expanded ? mdiChevronDown : mdiChevronRight" />
      <v-icon size="small" class="mr-1" :icon="mdiAccountMultiple" />
      Cohort Groups ({{ cohortGroups.length }})
    </div>

    <v-expand-transition>
      <div v-show="expanded">
        <v-list v-if="cohortGroups.length > 0" density="compact">
          <v-list-item v-for="group in cohortGroups" :key="group.id">
            <v-list-item-title>{{ group.name }}</v-list-item-title>
            <v-list-item-subtitle v-if="group.description">
              {{ group.description }}
            </v-list-item-subtitle>

            <template #append>
              <v-chip
                size="x-small"
                variant="tonal"
                :color="group.member_count === 0 ? 'warning' : 'primary'"
              >
                <v-icon
                  v-if="group.member_count === 0"
                  size="x-small"
                  start
                  :icon="mdiAlertCircleOutline"
                />
                {{ group.member_count }}
                {{ group.member_count === 1 ? 'member' : 'members' }}
              </v-chip>
              <v-btn
                :icon="mdiPencil"
                size="x-small"
                variant="text"
                class="ml-1"
                @click.stop="startEditCohort(group)"
              />
              <v-btn
                :icon="mdiDelete"
                size="x-small"
                variant="text"
                color="error"
                class="ml-1"
                @click.stop="confirmDeleteCohort(group)"
              />
            </template>
          </v-list-item>
        </v-list>

        <!-- Inline edit form -->
        <v-expand-transition>
          <v-card v-if="editingCohort !== null" variant="outlined" class="mt-2 mx-2">
            <v-card-text>
              <div class="text-title-small mb-3">Edit "{{ editingCohort.name }}"</div>
              <v-text-field
                v-model="cohortEditForm.name"
                label="Group Name"
                variant="outlined"
                density="compact"
                :error-messages="cohortNameError"
                class="mb-3"
                maxlength="100"
                counter
              />
              <v-text-field
                v-model="cohortEditForm.description"
                label="Description (optional)"
                variant="outlined"
                density="compact"
                class="mb-3"
                maxlength="500"
                counter
              />
              <div class="d-flex ga-2">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  :loading="cohortSaving"
                  :disabled="!isCohortFormValid"
                  @click="saveCohortEdit"
                >
                  Save
                </v-btn>
                <v-btn variant="outlined" size="small" @click="cancelCohortEdit"> Cancel </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-expand-transition>

        <div v-if="cohortGroups.length === 0" class="text-medium-emphasis text-body-medium py-4">
          No cohort groups defined.
        </div>
      </div>
    </v-expand-transition>
  </div>

  <!-- Delete Cohort Confirmation Dialog -->
  <v-dialog v-model="cohortDeleteDialog" max-width="400">
    <v-card>
      <v-card-title>Delete Cohort Group?</v-card-title>
      <v-card-text>
        <p>
          Are you sure you want to delete
          <strong>{{ cohortToDelete?.name }}</strong
          >?
        </p>
        <p v-if="cohortToDelete && cohortToDelete.member_count > 0" class="text-warning mt-2">
          <v-icon :icon="mdiAlert" size="small" class="mr-1" />
          This group has {{ cohortToDelete.member_count }}
          {{ cohortToDelete.member_count === 1 ? 'case' : 'cases' }} assigned. Deleting it will
          unlink all cases from this group.
        </p>
        <p
          v-else-if="cohortToDelete && cohortToDelete.member_count === 0"
          class="text-medium-emphasis mt-2"
        >
          This group has no members.
        </p>
        <p class="text-medium-emphasis mt-2">This action cannot be undone.</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cohortDeleteDialog = false">Cancel</v-btn>
        <v-btn color="error" variant="flat" :loading="cohortDeleting" @click="executeDeleteCohort">
          Delete
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Error snackbar (mirrors PanelManagerDialog's errorSnackbar/errorSnackbarText pattern) -->
  <v-snackbar v-model="errorSnackbar" color="error" :timeout="6000" location="bottom">
    {{ errorSnackbarText }}
    <template #actions>
      <v-btn variant="text" @click="errorSnackbar = false">Close</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { OverviewCohortGroup } from '../../../../shared/types/database-overview'
import { useApiService } from '../../composables/useApiService'
import {
  mdiAccountMultiple,
  mdiAlert,
  mdiAlertCircleOutline,
  mdiChevronDown,
  mdiChevronRight,
  mdiDelete,
  mdiPencil
} from '@mdi/js'
import { logService } from '../../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'

const props = defineProps<{
  cohortGroups: OverviewCohortGroup[]
}>()

const emit = defineEmits<{
  /** Emitted after a cohort is saved or deleted, so parent can reload data */
  refresh: []
}>()

const { api } = useApiService()

const expanded = ref(true)

// Cohort edit state
const editingCohort = ref<OverviewCohortGroup | null>(null)
const cohortEditForm = ref({ name: '', description: '' })
const cohortSaving = ref(false)

// Cohort delete state
const cohortDeleteDialog = ref(false)
const cohortToDelete = ref<OverviewCohortGroup | null>(null)
const cohortDeleting = ref(false)

// Error feedback for failed edit/delete IPC calls
const errorSnackbar = ref(false)
const errorSnackbarText = ref('')

/** Extract a user-facing message from a caught IPC/JS error. */
function describeError(err: unknown): string {
  return isIpcError(err)
    ? (err.userMessage ?? err.message)
    : err instanceof Error
      ? err.message
      : String(err)
}

// Cohort name validation
const cohortNameError = computed(() => {
  if (editingCohort.value !== null && cohortEditForm.value.name.trim() === '') {
    return 'Group name is required'
  }
  const trimmedName = cohortEditForm.value.name.trim().toLowerCase()
  if (editingCohort.value) {
    const duplicate = props.cohortGroups.find(
      (g) => g.name.toLowerCase() === trimmedName && g.id !== editingCohort.value!.id
    )
    if (duplicate) {
      return 'A group with this name already exists'
    }
  }
  return ''
})

const isCohortFormValid = computed(() => {
  return cohortEditForm.value.name.trim() !== '' && cohortNameError.value === ''
})

/** Start editing a cohort group */
function startEditCohort(group: OverviewCohortGroup): void {
  editingCohort.value = group
  cohortEditForm.value = {
    name: group.name,
    description: group.description ?? ''
  }
}

/** Cancel cohort editing */
function cancelCohortEdit(): void {
  editingCohort.value = null
  cohortEditForm.value = { name: '', description: '' }
}

/** Save cohort edit */
async function saveCohortEdit(): Promise<void> {
  if (!isCohortFormValid.value || editingCohort.value === null) return

  cohortSaving.value = true
  try {
    // wrapHandler resolves an IpcResult even on failure — a raw await here
    // would let a failed rename (e.g. a UNIQUE constraint violation) fall
    // through as if it had succeeded, closing the edit form and refreshing
    // the parent as though nothing went wrong.
    unwrapIpcResult(
      await api!.caseMetadata.updateCohort(editingCohort.value.id, {
        name: cohortEditForm.value.name.trim(),
        description: cohortEditForm.value.description.trim() || null
      })
    )
    cancelCohortEdit()
    emit('refresh')
  } catch (err) {
    const message = describeError(err)
    logService.error('Failed to update cohort group: ' + message, 'cohort')
    errorSnackbarText.value = message
    errorSnackbar.value = true
  } finally {
    cohortSaving.value = false
  }
}

/** Open delete confirmation for a cohort group */
function confirmDeleteCohort(group: OverviewCohortGroup): void {
  cohortToDelete.value = group
  cohortDeleteDialog.value = true
}

/** Execute cohort group deletion */
async function executeDeleteCohort(): Promise<void> {
  if (cohortToDelete.value === null) return

  cohortDeleting.value = true
  try {
    // Same discard-write hazard as saveCohortEdit: unwrap so a failed
    // delete throws instead of silently running the success branch below.
    unwrapIpcResult(await api!.caseMetadata.deleteCohort(cohortToDelete.value.id))

    // If we're editing the deleted group, close the edit form
    if (editingCohort.value?.id === cohortToDelete.value.id) {
      cancelCohortEdit()
    }

    emit('refresh')
  } catch (err) {
    const message = describeError(err)
    logService.error('Failed to delete cohort group: ' + message, 'cohort')
    errorSnackbarText.value = message
    errorSnackbar.value = true
  } finally {
    cohortDeleting.value = false
    cohortDeleteDialog.value = false
    cohortToDelete.value = null
  }
}

// Exposed for component tests to assert edit/delete failure behavior
// (does not close-and-refresh-as-success, surfaces the error) without
// reaching into Vuetify's menu/list internals. No behavior change.
defineExpose({
  editingCohort,
  cohortEditForm,
  cohortToDelete,
  cohortDeleteDialog,
  errorSnackbar,
  errorSnackbarText,
  startEditCohort,
  saveCohortEdit,
  confirmDeleteCohort,
  executeDeleteCohort
})
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
