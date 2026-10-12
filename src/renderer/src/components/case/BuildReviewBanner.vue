<template>
  <v-alert
    v-if="renameFailed"
    type="error"
    variant="tonal"
    density="compact"
    class="mx-2 my-1"
    data-testid="rename-failed"
  >
    {{ COPY.renameFailed }}
  </v-alert>
  <v-alert
    v-else-if="renameInProgress"
    type="info"
    variant="tonal"
    density="compact"
    class="mx-2 my-1"
    data-testid="rename-in-progress"
  >
    {{ COPY.renameInProgress }}
  </v-alert>
  <v-alert
    v-if="reviews.length > 0"
    type="warning"
    variant="tonal"
    density="compact"
    class="mx-2 my-1"
    data-testid="build-review-banner"
  >
    <div class="d-flex align-center flex-wrap ga-2">
      <span>{{ COPY.reviewBanner(reviews.length) }}</span>
      <v-btn size="small" variant="text" color="primary" @click="open = true">
        {{ COPY.reviewOpen }}
      </v-btn>
    </div>
  </v-alert>

  <v-dialog v-model="open" max-width="820" scrollable>
    <v-card :title="COPY.reviewTitle" data-testid="build-review-dialog">
      <v-card-text class="text-body-2">
        <p class="mb-2">{{ COPY.reviewIntro }}</p>
        <div class="d-flex align-center ga-2 mb-2">
          <span>{{ COPY.reviewSetSelected }}</span>
          <v-select
            v-model="bulkBuild"
            :items="buildItems"
            :aria-label="COPY.reviewSetSelected"
            :disabled="!canWrite || selected.size === 0"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 200px"
            @update:model-value="setSelected"
          />
        </div>
        <div class="review-head d-flex text-medium-emphasis">
          <span class="col-check" />
          <span class="col-case">{{ COPY.reviewCase }}</span>
          <span class="col-build">{{ COPY.reviewStored }}</span>
          <span class="col-build">{{ COPY.reviewSuggested }}</span>
          <span class="col-choice">{{ COPY.reviewChoice }}</span>
        </div>
        <v-virtual-scroll :items="lines" :item-height="ROW_HEIGHT" height="360">
          <template #default="{ item }">
            <div v-if="item.kind === 'group'" class="review-row review-group d-flex align-center">
              <v-checkbox-btn
                class="col-check"
                density="compact"
                :model-value="groupSelected(item.reason)"
                :aria-label="COPY.reviewSelectGroup(COPY.reviewReason[item.reason])"
                @update:model-value="selectGroup(item.reason, $event)"
              />
              <span class="font-weight-medium">
                {{ COPY.reviewReason[item.reason] }} ({{ item.count }})
              </span>
            </div>
            <div v-else class="review-row d-flex align-center">
              <v-checkbox-btn
                class="col-check"
                density="compact"
                :model-value="selected.has(item.review.caseId)"
                :aria-label="`Select ${item.review.caseName}`"
                @update:model-value="toggle(item.review.caseId, $event)"
              />
              <span class="col-case text-truncate">{{ item.review.caseName }}</span>
              <span class="col-build">{{ item.review.storedBuild }}</span>
              <span class="col-build">
                {{ item.review.suggestedBuild ?? EMPTY_VALUE_PLACEHOLDER }}
              </span>
              <v-select
                v-model="choices[item.review.caseId]"
                class="col-choice"
                :items="rowBuildItems"
                :aria-label="`${COPY.reviewChoice} of ${item.review.caseName}`"
                :disabled="!canWrite"
                density="compact"
                variant="outlined"
                hide-details
              />
            </div>
          </template>
        </v-virtual-scroll>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ COPY.reviewLater }}</v-btn>
        <v-btn
          variant="outlined"
          :disabled="!canWrite || selected.size === 0"
          :loading="applying"
          @click="applyChoices([...selected])"
        >
          {{ COPY.reviewApplySelected(selected.size) }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canWrite"
          :loading="applying"
          @click="applyChoices(reviews.map((r) => r.caseId))"
        >
          {{ COPY.reviewApplyAll(reviews.length) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Cases left unrenamed by the chromosome-name migration because their genome
 * build could not be confirmed. Each row starts at the build the header
 * names, else the stored one; the user confirms all, a selection or one
 * group of the same evidence at once, in one write.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  BUILD_COPY as COPY,
  IMPORTABLE_GENOME_BUILDS
} from '../../../../shared/config/genome-builds.config'
import type { BuildReview } from '../../../../shared/types/build-review'
import { EMPTY_VALUE_PLACEHOLDER } from '../../config/displayConfig'
import { useAppState } from '../../composables/useAppState'
import { useBuildReviews } from '../../composables/useBuildReviews'
import { usePermissions } from '../../composables/usePermissions'
import { useDatabaseStore } from '../../stores/databaseStore'

type Reason = BuildReview['reason']
type Line = { kind: 'group'; reason: Reason; count: number } | { kind: 'case'; review: BuildReview }

/** Dense row height of the virtual list (compact select). */
const ROW_HEIGHT = 40

const emit = defineEmits<{ resolved: [] }>()

const { reviews, renameInProgress, renameFailed, applying, load, apply } = useBuildReviews()
const { canWrite } = usePermissions()
const { showSnack, incrementDataGeneration } = useAppState()
const databaseStore = useDatabaseStore()
const open = ref(false)
const choices = reactive<Record<number, string>>({})
const selected = ref(new Set<number>())
const bulkBuild = ref<string | null>(null)
const buildItems = IMPORTABLE_GENOME_BUILDS.map((b) => ({ title: b.label, value: b.id }))
// Rows are narrow: the id alone (GRCh38); the menu and the bulk control show the label.
const rowBuildItems = IMPORTABLE_GENOME_BUILDS.map((b) => ({ title: b.id, value: b.id }))

// Preselect what the evidence says: the header's build, else the stored one.
watch(reviews, (list) => {
  for (const r of list) choices[r.caseId] ??= r.suggestedBuild ?? r.storedBuild
  selected.value = new Set([...selected.value].filter((id) => list.some((r) => r.caseId === id)))
})

const lines = computed<Line[]>(() => {
  const out: Line[] = []
  for (const reason of Object.keys(COPY.reviewReason) as Reason[]) {
    const group = reviews.value.filter((r) => r.reason === reason)
    if (group.length === 0) continue
    out.push({ kind: 'group', reason, count: group.length })
    for (const review of group) out.push({ kind: 'case', review })
  }
  return out
})

function toggle(caseId: number, on: boolean | null): void {
  const next = new Set(selected.value)
  if (on === true) next.add(caseId)
  else next.delete(caseId)
  selected.value = next
}

const groupIds = (reason: Reason): number[] =>
  reviews.value.filter((r) => r.reason === reason).map((r) => r.caseId)
const groupSelected = (reason: Reason): boolean =>
  groupIds(reason).every((id) => selected.value.has(id))

function selectGroup(reason: Reason, on: boolean | null): void {
  const next = new Set(selected.value)
  for (const id of groupIds(reason)) {
    if (on === true) next.add(id)
    else next.delete(id)
  }
  selected.value = next
}

function setSelected(build: string | null): void {
  if (build === null) return
  for (const id of selected.value) choices[id] = build
  bulkBuild.value = null
}

async function applyChoices(caseIds: number[]): Promise<void> {
  try {
    const applied = await apply(caseIds.map((caseId) => ({ caseId, build: choices[caseId] })))
    showSnack(COPY.reviewApplied(applied), 'success')
    if (reviews.value.length === 0) open.value = false
  } catch (error) {
    showSnack(error instanceof Error ? error.message : String(error), 'error')
  }
  // Renamed contigs and changed builds: open case and cohort views refetch.
  incrementDataGeneration()
  emit('resolved')
}

onMounted(load)
watch(() => databaseStore.revision, load)
</script>

<style scoped>
.review-head,
.review-row {
  gap: 8px;
  height: 40px;
}
.review-head {
  height: auto;
  padding-bottom: 4px;
}
.review-group {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.col-check {
  flex: 0 0 32px;
}
.col-case {
  flex: 1 1 auto;
  min-width: 0;
}
.col-build {
  flex: 0 0 80px;
}
.col-choice {
  flex: 0 0 170px;
}
</style>
