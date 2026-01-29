<template>
  <div class="comments-section">
    <div class="text-subtitle-2 mb-2">Comments</div>

    <!-- Global comment -->
    <div class="comment-block mb-3">
      <div class="d-flex align-center justify-space-between mb-1">
        <span class="text-caption font-weight-medium">Global Comment</span>
        <v-btn
          v-if="globalComment"
          icon
          size="x-small"
          variant="text"
          color="error"
          @click="confirmDeleteGlobal"
        >
          <v-icon size="small">mdi-delete</v-icon>
        </v-btn>
      </div>
      <InlineEditableText
        :model-value="globalComment"
        placeholder="Add a global comment..."
        :loading="globalSaving"
        @update:model-value="handleGlobalSave"
      />
      <div v-if="globalTimestamps" class="text-caption text-grey mt-1">
        {{ formatTimestamp(globalTimestamps.created_at) }}
        <span v-if="globalTimestamps.updated_at !== globalTimestamps.created_at">
          (edited {{ formatTimestamp(globalTimestamps.updated_at) }})
        </span>
      </div>
    </div>

    <!-- Per-case comment (only in case mode) -->
    <div v-if="mode === 'case' && caseId" class="comment-block">
      <div class="d-flex align-center justify-space-between mb-1">
        <span class="text-caption font-weight-medium">Case Comment</span>
        <v-btn
          v-if="perCaseComment"
          icon
          size="x-small"
          variant="text"
          color="error"
          @click="confirmDeletePerCase"
        >
          <v-icon size="small">mdi-delete</v-icon>
        </v-btn>
      </div>
      <InlineEditableText
        :model-value="perCaseComment"
        placeholder="Add a case-specific comment..."
        :loading="perCaseSaving"
        @update:model-value="handlePerCaseSave"
      />
      <div v-if="perCaseTimestamps" class="text-caption text-grey mt-1">
        {{ formatTimestamp(perCaseTimestamps.created_at) }}
        <span v-if="perCaseTimestamps.updated_at !== perCaseTimestamps.created_at">
          (edited {{ formatTimestamp(perCaseTimestamps.updated_at) }})
        </span>
      </div>
    </div>

    <!-- Delete confirmation dialog -->
    <v-dialog v-model="deleteDialogOpen" max-width="300">
      <v-card>
        <v-card-title class="text-h6">Delete Comment</v-card-title>
        <v-card-text>
          Are you sure you want to delete this {{ deleteTarget }} comment?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialogOpen = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="executeDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
/* global console */
import { ref, computed } from 'vue'
import { useAnnotations } from '../composables/useAnnotations'
import InlineEditableText from './InlineEditableText.vue'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'

interface Props {
  variant: Variant | CohortVariant
  caseId: number | null
  mode: 'case' | 'cohort'
}

const props = defineProps<Props>()

const {
  getAnnotations,
  upsertGlobalComment,
  upsertPerCaseComment,
  deleteGlobalComment,
  deletePerCaseComment
} = useAnnotations()

const globalSaving = ref(false)
const perCaseSaving = ref(false)
const deleteDialogOpen = ref(false)
const deleteTarget = ref<'global' | 'case'>('global')

// Get comments from cache
const globalComment = computed(() => {
  const annotations = getAnnotations(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
  return annotations?.global?.global_comment ?? null
})

const perCaseComment = computed(() => {
  const annotations = getAnnotations(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
  return annotations?.perCase?.per_case_comment ?? null
})

// Get timestamps
const globalTimestamps = computed(() => {
  const annotations = getAnnotations(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
  return annotations?.global
    ? {
        created_at: annotations.global.created_at,
        updated_at: annotations.global.updated_at
      }
    : null
})

const perCaseTimestamps = computed(() => {
  const annotations = getAnnotations(
    props.variant.chr,
    props.variant.pos,
    props.variant.ref,
    props.variant.alt
  )
  return annotations?.perCase
    ? {
        created_at: annotations.perCase.created_at,
        updated_at: annotations.perCase.updated_at
      }
    : null
})

// Save handlers
const handleGlobalSave = async (value: string | null) => {
  globalSaving.value = true
  try {
    await upsertGlobalComment(
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      value
    )
  } finally {
    globalSaving.value = false
  }
}

const handlePerCaseSave = async (value: string | null) => {
  if (props.caseId === null) return

  // For Variant type, we have id directly
  // For CohortVariant, we don't have a per-case variant ID - this shouldn't be called in cohort mode
  if (props.mode === 'cohort') {
    console.warn('Per-case comment save called in cohort mode')
    return
  }

  const variantId = (props.variant as Variant).id
  if (typeof variantId !== 'number') {
    console.error('Variant ID not available for per-case comment')
    return
  }

  perCaseSaving.value = true
  try {
    await upsertPerCaseComment(
      props.caseId,
      variantId,
      props.variant.chr,
      props.variant.pos,
      props.variant.ref,
      props.variant.alt,
      value
    )
  } finally {
    perCaseSaving.value = false
  }
}

// Delete confirmation
const confirmDeleteGlobal = () => {
  deleteTarget.value = 'global'
  deleteDialogOpen.value = true
}

const confirmDeletePerCase = () => {
  deleteTarget.value = 'case'
  deleteDialogOpen.value = true
}

const executeDelete = async () => {
  deleteDialogOpen.value = false

  if (deleteTarget.value === 'global') {
    globalSaving.value = true
    try {
      await deleteGlobalComment(
        props.variant.chr,
        props.variant.pos,
        props.variant.ref,
        props.variant.alt
      )
    } finally {
      globalSaving.value = false
    }
  } else {
    if (props.caseId === null) return

    const variantId = (props.variant as Variant).id
    if (typeof variantId !== 'number') {
      console.error('Variant ID not available for per-case comment deletion')
      return
    }

    perCaseSaving.value = true
    try {
      await deletePerCaseComment(
        props.caseId,
        variantId,
        props.variant.chr,
        props.variant.pos,
        props.variant.ref,
        props.variant.alt
      )
    } finally {
      perCaseSaving.value = false
    }
  }
}

// Format timestamp for display
const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString()
}
</script>
