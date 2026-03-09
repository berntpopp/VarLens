<template>
  <div class="mb-4">
    <div
      class="text-title-small mb-2 d-flex align-center cursor-pointer"
      @click="expanded = !expanded"
    >
      <v-icon size="small" class="mr-1">
        {{ expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
      </v-icon>
      <v-icon size="small" class="mr-1">mdi-tag-multiple</v-icon>
      Tags ({{ tags.length }})
    </div>

    <v-expand-transition>
      <div v-show="expanded">
        <v-list v-if="tags.length > 0" density="compact">
          <v-list-item v-for="tag in tags" :key="tag.id">
            <template #prepend>
              <div class="tag-color-indicator mr-3" :style="{ backgroundColor: tag.color }" />
            </template>

            <v-list-item-title>{{ tag.name }}</v-list-item-title>

            <template #append>
              <v-chip size="x-small" variant="tonal">
                {{ tag.usage_count }} {{ tag.usage_count === 1 ? 'use' : 'uses' }}
              </v-chip>
              <v-btn
                icon="mdi-pencil"
                size="x-small"
                variant="text"
                class="ml-1"
                @click.stop="startEditTag(tag)"
              />
              <v-btn
                icon="mdi-delete"
                size="x-small"
                variant="text"
                color="error"
                class="ml-1"
                @click.stop="confirmDeleteTag(tag)"
              />
            </template>
          </v-list-item>
        </v-list>

        <!-- Inline tag edit form -->
        <v-expand-transition>
          <v-card v-if="editingTag !== null" variant="outlined" class="mt-2 mx-2">
            <v-card-text>
              <div class="text-title-small mb-3">Edit "{{ editingTag.name }}"</div>
              <v-text-field
                v-model="tagEditForm.name"
                label="Tag Name"
                variant="outlined"
                density="compact"
                :error-messages="tagNameError"
                class="mb-3"
                maxlength="100"
                counter
              />
              <v-text-field
                v-model="tagEditForm.color"
                label="Color (hex)"
                variant="outlined"
                density="compact"
                class="mb-3"
                maxlength="7"
                placeholder="#000000"
              >
                <template #prepend-inner>
                  <div
                    class="tag-color-indicator"
                    :style="{ backgroundColor: tagEditForm.color }"
                  />
                </template>
              </v-text-field>
              <div class="d-flex ga-2">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  :loading="tagSaving"
                  :disabled="!isTagFormValid"
                  @click="saveTagEdit"
                >
                  Save
                </v-btn>
                <v-btn variant="outlined" size="small" @click="cancelTagEdit"> Cancel </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-expand-transition>

        <div v-if="tags.length === 0" class="text-medium-emphasis text-body-medium py-4">
          No tags defined.
        </div>
      </div>
    </v-expand-transition>
  </div>

  <!-- Delete Tag Confirmation Dialog -->
  <v-dialog v-model="tagDeleteDialog" max-width="400">
    <v-card>
      <v-card-title>Delete Tag?</v-card-title>
      <v-card-text>
        <p>
          Are you sure you want to delete
          <strong>{{ tagToDelete?.name }}</strong
          >?
        </p>
        <p v-if="tagToDelete && tagToDelete.usage_count > 0" class="text-warning mt-2">
          <v-icon icon="mdi-alert" size="small" class="mr-1" />
          This tag is assigned to {{ tagToDelete.usage_count }}
          {{ tagToDelete.usage_count === 1 ? 'variant' : 'variants' }}. Deleting it will remove all
          assignments.
        </p>
        <p
          v-else-if="tagToDelete && tagToDelete.usage_count === 0"
          class="text-medium-emphasis mt-2"
        >
          This tag is not assigned to any variants.
        </p>
        <p class="text-medium-emphasis mt-2">This action cannot be undone.</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="tagDeleteDialog = false">Cancel</v-btn>
        <v-btn color="error" variant="flat" :loading="tagDeleting" @click="executeDeleteTag">
          Delete
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { OverviewTag } from '../../../../shared/types/database-overview'
import { useApiService } from '../../composables/useApiService'

const props = defineProps<{
  tags: OverviewTag[]
}>()

const emit = defineEmits<{
  /** Emitted after a tag is saved or deleted, so parent can reload data */
  refresh: []
}>()

const { api } = useApiService()

const expanded = ref(true)

// Tag edit state
const editingTag = ref<OverviewTag | null>(null)
const tagEditForm = ref({ name: '', color: '' })
const tagSaving = ref(false)

// Tag delete state
const tagDeleteDialog = ref(false)
const tagToDelete = ref<OverviewTag | null>(null)
const tagDeleting = ref(false)

// Tag name validation
const tagNameError = computed(() => {
  if (editingTag.value !== null && tagEditForm.value.name.trim() === '') {
    return 'Tag name is required'
  }
  const trimmedName = tagEditForm.value.name.trim().toLowerCase()
  if (editingTag.value) {
    const duplicate = props.tags.find(
      (t) => t.name.toLowerCase() === trimmedName && t.id !== editingTag.value!.id
    )
    if (duplicate) {
      return 'A tag with this name already exists'
    }
  }
  return ''
})

const isTagFormValid = computed(() => {
  return tagEditForm.value.name.trim() !== '' && tagNameError.value === ''
})

/** Start editing a tag */
function startEditTag(tag: OverviewTag): void {
  editingTag.value = tag
  tagEditForm.value = {
    name: tag.name,
    color: tag.color
  }
}

/** Cancel tag editing */
function cancelTagEdit(): void {
  editingTag.value = null
  tagEditForm.value = { name: '', color: '' }
}

/** Save tag edit */
async function saveTagEdit(): Promise<void> {
  if (!isTagFormValid.value || editingTag.value === null) return

  tagSaving.value = true
  try {
    await api!.tags.update(editingTag.value.id, {
      name: tagEditForm.value.name.trim(),
      color: tagEditForm.value.color.trim()
    })
    cancelTagEdit()
    emit('refresh')
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to update tag:', err)
  } finally {
    tagSaving.value = false
  }
}

/** Open delete confirmation for a tag */
function confirmDeleteTag(tag: OverviewTag): void {
  tagToDelete.value = tag
  tagDeleteDialog.value = true
}

/** Execute tag deletion */
async function executeDeleteTag(): Promise<void> {
  if (tagToDelete.value === null) return

  tagDeleting.value = true
  try {
    await api!.tags.delete(tagToDelete.value.id)

    // If we're editing the deleted tag, close the edit form
    if (editingTag.value?.id === tagToDelete.value.id) {
      cancelTagEdit()
    }

    emit('refresh')
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to delete tag:', err)
  } finally {
    tagDeleting.value = false
    tagDeleteDialog.value = false
    tagToDelete.value = null
  }
}
</script>

<style scoped>
.tag-color-indicator {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
