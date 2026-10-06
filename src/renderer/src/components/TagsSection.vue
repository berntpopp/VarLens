<template>
  <div class="tags-section">
    <div class="d-flex align-center justify-space-between mb-2">
      <h3 class="text-title-small">Tags</h3>
      <v-menu
        v-if="canWrite"
        v-model="menuOpen"
        :close-on-content-click="false"
        location="bottom end"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            aria-label="Add tag"
            v-bind="menuProps"
            icon
            size="x-small"
            variant="text"
            :loading="loading"
          >
            <v-icon size="small" :icon="mdiPlus" />
          </v-btn>
        </template>
        <v-card min-width="200" max-width="280">
          <v-card-text class="pa-2">
            <div v-if="availableTags.length === 0" class="text-body-small text-muted pa-2">
              No tags available. Create tags in Settings.
            </div>
            <v-list v-else density="compact" class="pa-0">
              <v-list-item
                v-for="tag in availableTags"
                :key="tag.id"
                :class="{ 'bg-grey-lighten-4': isTagAssigned(tag.id) }"
                @click="toggleTag(tag.id)"
              >
                <template #prepend>
                  <v-icon
                    :color="tag.color"
                    size="small"
                    class="mr-2"
                    :icon="isTagAssigned(tag.id) ? mdiCheckboxMarked : mdiCheckboxBlankOutline"
                  />
                </template>
                <v-list-item-title class="text-body-medium">{{ tag.name }}</v-list-item-title>
                <template #append>
                  <div class="tag-color-dot" :style="{ backgroundColor: tag.color }"></div>
                </template>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-menu>
    </div>

    <!-- Assigned tags display -->
    <div class="tags-container">
      <div v-if="assignedTags.length === 0" class="text-body-small text-muted">
        No tags assigned
      </div>
      <div v-else class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="tag in assignedTags"
          :key="tag.id"
          :color="tag.color"
          size="small"
          variant="flat"
          :closable="canWrite"
          :disabled="loading"
          @click:close="removeTag(tag.id)"
        >
          {{ tag.name }}
        </v-chip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useTags } from '../composables/useTags'
import { usePermissions } from '../composables/usePermissions'
import type { Tag } from '../../../shared/types/database-entities'
import { mdiCheckboxBlankOutline, mdiCheckboxMarked, mdiPlus } from '@mdi/js'
import { logService } from '../services/LogService'

interface Props {
  /** Case ID for per-case tag assignments */
  caseId: number
  /** Variant ID for tag assignments */
  variantId: number
}

const props = defineProps<Props>()
const { canWrite } = usePermissions()

const emit = defineEmits<{
  changed: []
}>()

const {
  loadTags,
  getTags,
  loadVariantTags,
  getVariantTags,
  isVariantTagsLoading,
  assignVariantTag,
  removeVariantTag
} = useTags()

const menuOpen = ref(false)
const loading = ref(false)

// Available tags (all tags in the system)
const availableTags = computed<Tag[]>(() => getTags())

// Assigned tags for this variant
const assignedTags = computed<Tag[]>(() => getVariantTags(props.caseId, props.variantId))

// Check if a tag is assigned
const isTagAssigned = (tagId: number): boolean => {
  return assignedTags.value.some((t) => t.id === tagId)
}

// Toggle tag assignment
const toggleTag = async (tagId: number) => {
  loading.value = true
  try {
    if (isTagAssigned(tagId)) {
      await removeVariantTag(props.caseId, props.variantId, tagId)
    } else {
      await assignVariantTag(props.caseId, props.variantId, tagId)
    }
    emit('changed')
  } catch (error) {
    logService.error(
      'Failed to toggle tag: ' + (error instanceof Error ? error.message : String(error)),
      'tags'
    )
  } finally {
    loading.value = false
  }
}

// Remove tag from variant
const removeTag = async (tagId: number) => {
  loading.value = true
  try {
    await removeVariantTag(props.caseId, props.variantId, tagId)
    emit('changed')
  } catch (error) {
    logService.error(
      'Failed to remove tag: ' + (error instanceof Error ? error.message : String(error)),
      'tags'
    )
  } finally {
    loading.value = false
  }
}

// Watch for loading state from composable
watch(
  () => isVariantTagsLoading(props.caseId, props.variantId),
  (isLoading) => {
    loading.value = isLoading
  }
)

// Load tags on mount and when variant changes
onMounted(async () => {
  await Promise.all([loadTags(), loadVariantTags(props.caseId, props.variantId)])
})

// Reload tags when variant changes
watch(
  () => [props.caseId, props.variantId],
  async ([newCaseId, newVariantId]) => {
    if (typeof newCaseId === 'number' && typeof newVariantId === 'number') {
      await loadVariantTags(newCaseId, newVariantId)
    }
  }
)
</script>

<style scoped>
.tags-section {
  padding: 8px 0;
}

.tags-container {
  min-height: 32px;
}

.tag-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
