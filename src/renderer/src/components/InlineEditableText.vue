<template>
  <div class="inline-editable">
    <!-- Display mode -->
    <div v-if="!isEditing" class="editable-text d-flex align-center" @click="startEdit">
      <span :class="{ 'text-grey': !modelValue }">
        {{ modelValue || placeholder }}
      </span>
      <v-icon size="x-small" class="edit-icon ml-1">mdi-pencil</v-icon>
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

interface Props {
  modelValue: string | null
  placeholder?: string
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Click to add...',
  loading: false
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

const saveEdit = () => {
  const trimmed = editValue.value.trim()
  emit('update:modelValue', trimmed.length > 0 ? trimmed : null)
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
  background: rgba(var(--v-theme-primary), 0.05);
}

.edit-icon {
  opacity: 0;
  transition: opacity 0.15s;
}

.editable-text:hover .edit-icon {
  opacity: 0.6;
}
</style>
