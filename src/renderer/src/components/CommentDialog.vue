<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>
        <v-icon class="mr-2">mdi-comment-text-outline</v-icon>
        Variant Comments
      </v-card-title>

      <v-card-text>
        <v-tabs v-model="activeTab">
          <v-tab value="global">Global</v-tab>
          <v-tab value="perCase">This Case</v-tab>
        </v-tabs>

        <v-window v-model="activeTab">
          <!-- Global comment tab -->
          <v-window-item value="global">
            <v-textarea
              v-model="localGlobalComment"
              label="Global comment (visible across all cases)"
              rows="4"
              variant="outlined"
              class="mt-4"
            />
            <div v-if="globalTimestamps" class="text-caption text-grey mt-1">
              Created: {{ formatTimestamp(globalTimestamps.created_at) }}
              <span v-if="globalTimestamps.updated_at !== globalTimestamps.created_at">
                | Updated: {{ formatTimestamp(globalTimestamps.updated_at) }}
              </span>
            </div>
          </v-window-item>

          <!-- Per-case comment tab -->
          <v-window-item value="perCase">
            <v-textarea
              v-model="localPerCaseComment"
              label="Case-specific comment"
              rows="4"
              variant="outlined"
              class="mt-4"
            />
            <div v-if="perCaseTimestamps" class="text-caption text-grey mt-1">
              Created: {{ formatTimestamp(perCaseTimestamps.created_at) }}
              <span v-if="perCaseTimestamps.updated_at !== perCaseTimestamps.created_at">
                | Updated: {{ formatTimestamp(perCaseTimestamps.updated_at) }}
              </span>
            </div>
          </v-window-item>
        </v-window>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="handleCancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="handleSave">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  modelValue: boolean
  globalComment: string | null
  perCaseComment: string | null
  globalTimestamps: { created_at: number; updated_at: number } | null
  perCaseTimestamps: { created_at: number; updated_at: number } | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [
    data: {
      globalComment: string | null
      perCaseComment: string | null
      globalChanged: boolean
      perCaseChanged: boolean
    }
  ]
}>()

// Local state for editing
const activeTab = ref<'global' | 'perCase'>('global')
const localGlobalComment = ref<string>('')
const localPerCaseComment = ref<string>('')

// Track initial values for change detection
const initialGlobalComment = ref<string | null>(null)
const initialPerCaseComment = ref<string | null>(null)

// Reset local state when dialog opens
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue) {
      // Dialog is opening - initialize local state from props
      localGlobalComment.value = props.globalComment ?? ''
      localPerCaseComment.value = props.perCaseComment ?? ''
      initialGlobalComment.value = props.globalComment
      initialPerCaseComment.value = props.perCaseComment
      activeTab.value = 'global'
    }
  }
)

// Format timestamp for display
const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString()
}

// Handle cancel - close dialog without saving
const handleCancel = () => {
  emit('update:modelValue', false)
}

// Handle save - emit changes and close dialog
const handleSave = () => {
  // Normalize empty strings to null
  const finalGlobalComment =
    localGlobalComment.value.trim() === '' ? null : localGlobalComment.value.trim()
  const finalPerCaseComment =
    localPerCaseComment.value.trim() === '' ? null : localPerCaseComment.value.trim()

  // Detect changes
  const globalChanged = finalGlobalComment !== initialGlobalComment.value
  const perCaseChanged = finalPerCaseComment !== initialPerCaseComment.value

  emit('save', {
    globalComment: finalGlobalComment,
    perCaseComment: finalPerCaseComment,
    globalChanged,
    perCaseChanged
  })
}
</script>
