<template>
  <div>
    <!-- Add comment form -->
    <v-card variant="outlined" class="mb-3">
      <v-card-text class="pa-3">
        <div class="d-flex ga-2 mb-2">
          <v-select
            v-model="newCategory"
            :items="COMMENT_CATEGORIES"
            label="Category"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 200px"
          >
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <v-icon
                    :color="
                      COMMENT_CATEGORY_COLORS[(item as unknown as { title: CommentCategory }).title]
                    "
                    size="small"
                  >
                    {{
                      COMMENT_CATEGORY_ICONS[(item as unknown as { title: CommentCategory }).title]
                    }}
                  </v-icon>
                </template>
              </v-list-item>
            </template>
          </v-select>
        </div>
        <v-textarea
          v-model="newContent"
          label="Add a comment..."
          density="compact"
          variant="outlined"
          hide-details
          rows="2"
          auto-grow
        />
        <div class="d-flex justify-end mt-2">
          <v-btn
            color="primary"
            size="small"
            :disabled="!newContent.trim()"
            :loading="isCreating"
            @click="handleCreate"
          >
            Add Comment
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <!-- Comments list -->
    <template v-else>
      <div v-if="comments.length === 0" class="text-center text-medium-emphasis py-4">
        No comments yet
      </div>

      <v-card v-for="comment in comments" :key="comment.id" variant="outlined" class="mb-2">
        <v-card-text class="pa-3">
          <!-- Header -->
          <div class="d-flex align-center justify-space-between mb-1">
            <div class="d-flex align-center ga-2">
              <v-chip :color="COMMENT_CATEGORY_COLORS[comment.category]" size="x-small" label>
                <v-icon start size="x-small">
                  {{ COMMENT_CATEGORY_ICONS[comment.category] }}
                </v-icon>
                {{ comment.category }}
              </v-chip>
              <span class="text-caption text-medium-emphasis">
                {{ formatTimestamp(comment.created_at) }}
              </span>
              <span v-if="comment.updated_at" class="text-caption text-medium-emphasis font-italic">
                (edited)
              </span>
            </div>
            <div>
              <v-btn
                aria-label="Edit comment"
                :icon="mdiPencilOutline"
                size="x-small"
                variant="text"
                @click="startEdit(comment)"
              />
              <v-btn
                aria-label="Delete comment"
                :icon="mdiDeleteOutline"
                size="x-small"
                variant="text"
                color="error"
                @click="handleDelete(comment.id)"
              />
            </div>
          </div>

          <!-- Content (view or edit mode) -->
          <template v-if="editingId === comment.id">
            <v-textarea
              v-model="editContent"
              density="compact"
              variant="outlined"
              hide-details
              rows="2"
              auto-grow
              class="mt-2"
            />
            <div class="d-flex justify-end ga-2 mt-2">
              <v-btn size="x-small" variant="text" @click="cancelEdit">Cancel</v-btn>
              <v-btn
                size="x-small"
                color="primary"
                :disabled="!editContent.trim()"
                :loading="isSaving"
                @click="handleUpdate(comment.id)"
              >
                Save
              </v-btn>
            </div>
          </template>
          <div v-else class="text-body-2" style="white-space: pre-wrap">
            {{ comment.content }}
          </div>
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  useCaseComments,
  COMMENT_CATEGORIES,
  COMMENT_CATEGORY_ICONS,
  COMMENT_CATEGORY_COLORS
} from '../composables/useCaseComments'
import type { CaseComment, CommentCategory } from '../../../shared/types/api'
import { mdiDeleteOutline, mdiPencilOutline } from '@mdi/js'
import { logService } from '../services/LogService'
import { isIpcError } from '../../../shared/types/errors'

const props = defineProps<{
  caseId: number
}>()

const { loadComments, getComments, isLoading, createComment, updateComment, deleteComment } =
  useCaseComments()

// New comment form
const newCategory = ref<CommentCategory>('Clinical Note')
const newContent = ref('')
const isCreating = ref(false)

// Edit state
const editingId = ref<number | null>(null)
const editContent = ref('')
const isSaving = ref(false)

// Computed
const loading = computed(() => isLoading(props.caseId))
const comments = computed(() => getComments(props.caseId))

// Load on mount/caseId change
watch(
  () => props.caseId,
  async (id) => {
    if (id) await loadComments(id)
  },
  { immediate: true }
)

async function handleCreate(): Promise<void> {
  if (!newContent.value.trim()) return
  isCreating.value = true
  try {
    await createComment(props.caseId, newCategory.value, newContent.value.trim())
    newContent.value = ''
  } catch (error) {
    logService.error(
      'Failed to create comment: ' +
        (error instanceof Error
          ? error.message
          : isIpcError(error)
            ? (error.userMessage ?? error.message)
            : String(error)),
      'comments'
    )
  } finally {
    isCreating.value = false
  }
}

function startEdit(comment: CaseComment): void {
  editingId.value = comment.id
  editContent.value = comment.content
}

function cancelEdit(): void {
  editingId.value = null
  editContent.value = ''
}

async function handleUpdate(commentId: number): Promise<void> {
  if (!editContent.value.trim()) return
  isSaving.value = true
  try {
    await updateComment(props.caseId, commentId, editContent.value.trim())
    editingId.value = null
    editContent.value = ''
  } catch (error) {
    logService.error(
      'Failed to update comment: ' +
        (error instanceof Error
          ? error.message
          : isIpcError(error)
            ? (error.userMessage ?? error.message)
            : String(error)),
      'comments'
    )
  } finally {
    isSaving.value = false
  }
}

async function handleDelete(commentId: number): Promise<void> {
  try {
    await deleteComment(props.caseId, commentId)
  } catch (error) {
    logService.error(
      'Failed to delete comment: ' +
        (error instanceof Error
          ? error.message
          : isIpcError(error)
            ? (error.userMessage ?? error.message)
            : String(error)),
      'comments'
    )
  }
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts))
}
</script>
