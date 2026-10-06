<template>
  <div class="d-flex align-center ga-1">
    <!-- Star toggle -->
    <button
      type="button"
      class="annotation-btn"
      :class="{ 'has-global': showGlobalIndicators && displayGlobalStarred }"
      :aria-label="labels.star"
      :aria-pressed="displayStarred"
      :data-tooltip="labels.star"
      data-tooltip-location="top"
      :disabled="readOnly"
      @click.stop="emit('star-toggle')"
    >
      <v-icon
        :icon="displayStarred ? mdiStar : mdiStarOutline"
        :color="displayStarred ? 'star' : 'muted'"
        size="x-small"
      />
    </button>

    <!-- ACMG classification (menu with quick-classify + evidence editor) -->
    <v-menu :close-on-content-click="true" :disabled="readOnly">
      <template #activator="{ props: menuProps }">
        <button
          v-bind="menuProps"
          type="button"
          class="annotation-btn"
          :class="{ 'has-global': showGlobalIndicators && displayGlobalAcmg }"
          :aria-label="labels.acmg"
          :data-tooltip="labels.acmg"
          data-tooltip-location="top"
        >
          <v-chip v-if="displayAcmg" :color="ACMG_COLORS[displayAcmg]" size="x-small" label>
            {{ ACMG_ABBREV[displayAcmg] }}
          </v-chip>
          <v-icon v-else :icon="mdiClipboardCheckOutline" size="x-small" color="muted" />
        </button>
      </template>
      <v-card class="pa-2" min-width="200">
        <div class="d-flex flex-wrap ga-1 mb-2">
          <v-chip
            v-for="cls in ACMG_CLASSIFICATIONS"
            :key="cls"
            :color="displayAcmg === cls ? ACMG_COLORS[cls] : undefined"
            :variant="displayAcmg === cls ? 'flat' : 'outlined'"
            size="small"
            label
            class="cursor-pointer"
            @click="emit('acmg-select', cls)"
          >
            {{ ACMG_ABBREV[cls] }}
          </v-chip>
        </div>
        <v-divider class="mb-1" />
        <v-list density="compact" class="pa-0">
          <v-list-item class="px-1" @click="emit('acmg-evidence-click')">
            <template #prepend>
              <v-icon size="small" class="mr-1" :icon="mdiClipboardCheckOutline" />
            </template>
            <v-list-item-title class="text-caption font-weight-medium">
              Evidence editor...
            </v-list-item-title>
          </v-list-item>
          <v-list-item v-if="displayAcmg" class="px-1" @click="emit('acmg-select', null)">
            <v-list-item-title class="text-caption text-medium-emphasis">
              Clear classification
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>

    <!-- Comment -->
    <button
      type="button"
      class="annotation-btn"
      :class="{ 'has-global': showGlobalIndicators && displayHasGlobalComment }"
      :aria-label="labels.comment"
      :data-tooltip="labels.comment"
      data-tooltip-location="top"
      @click.stop="emit('comment-click')"
    >
      <v-icon
        :icon="commentFilled ? mdiCommentText : mdiCommentTextOutline"
        :color="commentFilled ? 'primary' : 'muted'"
        size="x-small"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import type { AnnotationScope } from '../../../../shared/types/annotations'
import { ACMG_COLORS, ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../../composables/useAnnotations'
import {
  mdiClipboardCheckOutline,
  mdiCommentText,
  mdiCommentTextOutline,
  mdiStar,
  mdiStarOutline
} from '@mdi/js'
import {
  acmgLabel,
  commentLabel,
  starLabel,
  type AnnotationDisplayState
} from './annotations-cell-labels'

interface Props {
  /** Current starred state (per-case for Case Analysis, global for Cohort) */
  isStarred: boolean
  /** Global starred state (Case Analysis only) */
  isGlobalStarred?: boolean
  /** Current ACMG classification (per-case for Case Analysis, global for Cohort) */
  acmgClassification: AcmgClassification | null
  /** Global ACMG classification (Case Analysis only) */
  globalAcmgClassification?: AcmgClassification | null
  /** Has comment (per-case for Case Analysis, global for Cohort) */
  hasComment: boolean
  /** Has global comment (Case Analysis only) */
  hasGlobalComment?: boolean
  /** Show global indicator rings (true for Case Analysis, false for Cohort) */
  showGlobalIndicators?: boolean
  /** Annotation scope: controls display priority and action routing */
  annotationScope?: AnnotationScope
  /** Viewer role: star and ACMG are display-only (comment still opens read-only). */
  readOnly?: boolean
}

interface Emits {
  (e: 'star-toggle'): void
  (e: 'acmg-select', classification: AcmgClassification | null): void
  (e: 'acmg-evidence-click'): void
  (e: 'comment-click'): void
}

const props = withDefaults(defineProps<Props>(), {
  isGlobalStarred: false,
  globalAcmgClassification: null,
  hasGlobalComment: false,
  showGlobalIndicators: true,
  annotationScope: 'case'
})

const emit = defineEmits<Emits>()

// Display swap: in "all" mode, global becomes primary, per-case becomes ring indicator
const displayStarred = computed(() =>
  props.annotationScope === 'all' ? props.isGlobalStarred : props.isStarred
)
const displayGlobalStarred = computed(() =>
  props.annotationScope === 'all' ? props.isStarred : props.isGlobalStarred
)
const displayAcmg = computed(() =>
  props.annotationScope === 'all' ? props.globalAcmgClassification : props.acmgClassification
)
const displayGlobalAcmg = computed(() =>
  props.annotationScope === 'all' ? props.acmgClassification : props.globalAcmgClassification
)
const displayHasComment = computed(() =>
  props.annotationScope === 'all' ? props.hasGlobalComment : props.hasComment
)
const displayHasGlobalComment = computed(() =>
  props.annotationScope === 'all' ? props.hasComment : props.hasGlobalComment
)

// Case Analysis fills the comment icon for either scope; Cohort only for its own
const commentFilled = computed(() =>
  props.showGlobalIndicators
    ? displayHasComment.value || displayHasGlobalComment.value
    : displayHasComment.value
)

// One string per action: aria-label and delegated tooltip (no per-cell v-tooltip)
const labels = computed(() => {
  const state: AnnotationDisplayState = {
    scope: props.annotationScope,
    showGlobalIndicators: props.showGlobalIndicators,
    starred: displayStarred.value,
    secondaryStarred: displayGlobalStarred.value,
    acmg: displayAcmg.value,
    secondaryAcmg: displayGlobalAcmg.value,
    hasComment: displayHasComment.value,
    secondaryHasComment: displayHasGlobalComment.value
  }
  return { star: starLabel(state), acmg: acmgLabel(state), comment: commentLabel(state) }
})
</script>
