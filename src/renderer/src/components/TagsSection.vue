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
import { ref, computed } from 'vue'
import { useTags } from '../composables/useTags'
import { useVariantTags } from '../composables/useVariantTags'
import { usePermissions } from '../composables/usePermissions'
import type { Tag } from '../../../shared/types/database-entities'
import { mdiCheckboxBlankOutline, mdiCheckboxMarked, mdiPlus } from '@mdi/js'
import { logService } from '../services/LogService'
import { formatError } from '../utils/ipc-result'

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

const { getTags } = useTags()
const {
  variantTags: assignedTags,
  isLoading,
  assignTag,
  removeTag: removeVariantTag
} = useVariantTags(
  () => props.caseId,
  () => props.variantId
)

const menuOpen = ref(false)
const writing = ref(false)
const loading = computed(() => isLoading.value || writing.value)

// Available tags (all tags in the system)
const availableTags = computed<Tag[]>(() => getTags())

const isTagAssigned = (tagId: number): boolean => assignedTags.value.some((t) => t.id === tagId)

async function write(action: string, run: () => Promise<void>): Promise<void> {
  writing.value = true
  try {
    await run()
    emit('changed')
  } catch (error) {
    logService.error(`Failed to ${action} tag: ${formatError(error)}`, 'tags')
  } finally {
    writing.value = false
  }
}

const toggleTag = (tagId: number): Promise<void> =>
  write('toggle', async () => {
    const tag = availableTags.value.find((t) => t.id === tagId)
    if (isTagAssigned(tagId)) await removeVariantTag(tagId)
    else if (tag !== undefined) await assignTag(tag)
  })

const removeTag = (tagId: number): Promise<void> => write('remove', () => removeVariantTag(tagId))
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
