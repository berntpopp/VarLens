<template>
  <v-dialog v-model="isOpen" max-width="600" scrollable>
    <v-card>
      <v-card-title>Custom Tags</v-card-title>
      <v-card-text>
        <!-- Tag List -->
        <div class="mb-4">
          <div class="text-subtitle-2 mb-2">Defined Tags</div>

          <v-list v-if="tags.length > 0" density="compact">
            <v-list-item v-for="tag in tags" :key="tag.id">
              <template #prepend>
                <div class="tag-color-indicator mr-3" :style="{ backgroundColor: tag.color }" />
              </template>

              <v-list-item-title>{{ tag.name }}</v-list-item-title>

              <template #append>
                <v-btn icon="mdi-pencil" size="x-small" variant="text" @click="startEditTag(tag)" />
                <v-btn
                  icon="mdi-delete"
                  size="x-small"
                  variant="text"
                  @click="confirmDeleteTag(tag)"
                />
              </template>
            </v-list-item>
          </v-list>

          <div v-else class="text-medium-emphasis text-body-2 py-4">
            No custom tags defined. Create one below.
          </div>

          <v-btn
            color="primary"
            variant="outlined"
            prepend-icon="mdi-plus"
            class="mt-2"
            @click="startAddTag"
          >
            Add Tag
          </v-btn>
        </div>

        <!-- Edit/Add Form -->
        <v-expand-transition>
          <v-card v-if="editingTag !== null" variant="outlined" class="mt-4">
            <v-card-text>
              <div class="text-subtitle-2 mb-3">
                {{ isAddMode ? 'Add Tag' : `Edit "${editingTag.name}"` }}
              </div>

              <v-text-field
                v-model="editForm.name"
                label="Tag Name"
                variant="outlined"
                density="compact"
                :error-messages="nameError"
                class="mb-3"
                maxlength="50"
                counter
              />

              <ColorSwatchPicker v-model="editForm.color" label="Color" class="mb-4" />

              <div class="d-flex ga-2">
                <v-btn
                  color="primary"
                  variant="flat"
                  :loading="isSaving"
                  :disabled="!isFormValid"
                  @click="saveEdit"
                >
                  Save
                </v-btn>
                <v-btn variant="outlined" @click="cancelEdit">Cancel</v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-expand-transition>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="isOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Tag?</v-card-title>
        <v-card-text>
          <p v-if="tagToDelete">
            Are you sure you want to delete the tag "{{ tagToDelete.name }}"?
          </p>
          <p v-if="deleteUsageCount > 0" class="text-warning mt-2">
            <v-icon icon="mdi-alert" size="small" class="mr-1" />
            This tag is currently assigned to {{ deleteUsageCount }}
            {{ deleteUsageCount === 1 ? 'variant' : 'variants' }}. Deleting it will remove the tag
            from all variants.
          </p>
          <p class="text-medium-emphasis mt-2">This action cannot be undone.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="isDeleting" @click="executeDelete">
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTags, TAG_COLORS } from '../composables/useTags'
import ColorSwatchPicker from './ColorSwatchPicker.vue'
import type { Tag } from '../../../main/database/types'

const { loadTags, getTags, createTag, updateTag, deleteTag, getTagUsageCount } = useTags()

const isOpen = ref(false)

// Tag list computed from composable
const tags = computed(() => getTags())

// Edit state
const editingTag = ref<Tag | null>(null)
const isAddMode = ref(false)
const editForm = ref({
  name: '',
  color: TAG_COLORS[0]
})
const isSaving = ref(false)

// Delete confirmation
const deleteDialog = ref(false)
const tagToDelete = ref<Tag | null>(null)
const deleteUsageCount = ref(0)
const isDeleting = ref(false)

// Validation
const nameError = computed(() => {
  if (editingTag.value !== null && editForm.value.name.trim() === '') {
    return 'Tag name is required'
  }
  // Check for duplicate names (excluding current tag if editing)
  const trimmedName = editForm.value.name.trim().toLowerCase()
  const duplicate = tags.value.find(
    (t) =>
      t.name.toLowerCase() === trimmedName && (!editingTag.value || t.id !== editingTag.value.id)
  )
  if (duplicate) {
    return 'A tag with this name already exists'
  }
  return ''
})

const isFormValid = computed(() => {
  return editForm.value.name.trim() !== '' && editForm.value.color !== '' && nameError.value === ''
})

const startEditTag = (tag: Tag): void => {
  editingTag.value = tag
  isAddMode.value = false
  editForm.value = {
    name: tag.name,
    color: tag.color
  }
}

const startAddTag = (): void => {
  editingTag.value = {} as Tag
  isAddMode.value = true
  editForm.value = {
    name: '',
    color: TAG_COLORS[0]
  }
}

const cancelEdit = (): void => {
  editingTag.value = null
  isAddMode.value = false
}

const saveEdit = async (): Promise<void> => {
  if (!isFormValid.value || editingTag.value === null) return

  isSaving.value = true
  try {
    if (isAddMode.value) {
      await createTag(editForm.value.name.trim(), editForm.value.color)
    } else {
      await updateTag(editingTag.value.id, {
        name: editForm.value.name.trim(),
        color: editForm.value.color
      })
    }
    cancelEdit()
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to save tag:', error)
  } finally {
    isSaving.value = false
  }
}

const confirmDeleteTag = async (tag: Tag): Promise<void> => {
  tagToDelete.value = tag
  // Fetch usage count for the confirmation message
  try {
    deleteUsageCount.value = await getTagUsageCount(tag.id)
  } catch {
    deleteUsageCount.value = 0
  }
  deleteDialog.value = true
}

const executeDelete = async (): Promise<void> => {
  if (tagToDelete.value === null) return

  isDeleting.value = true
  try {
    await deleteTag(tagToDelete.value.id)
    // If we were editing this tag, close the edit form
    if (editingTag.value?.id === tagToDelete.value.id) {
      cancelEdit()
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to delete tag:', error)
  } finally {
    isDeleting.value = false
    deleteDialog.value = false
    tagToDelete.value = null
  }
}

// Load tags when dialog opens
watch(isOpen, async (open) => {
  if (open) {
    await loadTags()
    cancelEdit()
  }
})

const show = (): void => {
  isOpen.value = true
}

defineExpose({ show })
</script>

<style scoped>
.tag-color-indicator {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
}
</style>
