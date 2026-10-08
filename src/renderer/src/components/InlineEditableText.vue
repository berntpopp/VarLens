<template>
  <div class="inline-editable">
    <!-- Display mode -->
    <div v-if="readonly" class="d-flex align-center">
      <span :class="{ 'text-muted': !modelValue }">{{ modelValue || '—' }}</span>
    </div>
    <div v-else-if="!isEditing" class="editable-text d-flex align-center" @click="startEdit">
      <span :class="{ 'text-muted': !modelValue }">
        {{ modelValue || placeholder }}
      </span>
      <v-icon size="x-small" class="edit-icon ml-1" :icon="mdiPencil" />
    </div>

    <!-- Edit mode -->
    <v-textarea
      v-else
      ref="inputRef"
      v-model="editValue"
      auto-grow
      rows="2"
      variant="outlined"
      density="compact"
      hide-details
      :loading="loading"
      @blur="saveEdit"
      @keydown.escape="cancelEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { mdiPencil } from '@mdi/js'

interface Props {
  modelValue: string | null
  placeholder?: string
  loading?: boolean
  /** Display only (e.g. viewer role): no edit affordance. */
  readonly?: boolean
  /** Saves the value; the editor stays open, text kept, unless it resolves true. */
  save?: (value: string | null) => Promise<boolean>
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Click to add...',
  loading: false,
  readonly: false,
  save: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const isEditing = ref(false)
const editValue = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

const startEdit = () => {
  isEditing.value = true
  editValue.value = props.modelValue ?? ''
  nextTick(() => {
    inputRef.value?.focus()
  })
}

const saveEdit = async () => {
  const trimmed = editValue.value.trim()
  const value = trimmed.length > 0 ? trimmed : null
  if (props.save) {
    if (!(await props.save(value))) return
  } else {
    emit('update:modelValue', value)
  }
  isEditing.value = false
}

const cancelEdit = () => {
  isEditing.value = false
}
</script>

<style scoped>
.editable-text {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  min-height: 32px;
}

.editable-text:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 5%, transparent);
}

.edit-icon {
  opacity: 0;
  transition: opacity 0.15s;
}

.editable-text:hover .edit-icon {
  opacity: 0.6;
}
</style>
