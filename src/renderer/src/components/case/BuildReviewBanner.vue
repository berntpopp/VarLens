<template>
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

  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card :title="COPY.reviewTitle" data-testid="build-review-dialog">
      <v-card-text class="text-body-2">
        <p class="mb-2">{{ COPY.reviewIntro }}</p>
        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ COPY.reviewCase }}</th>
              <th>{{ COPY.reviewStored }}</th>
              <th>{{ COPY.reviewSuggested }}</th>
              <th>{{ COPY.reviewChoice }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="review in reviews" :key="review.caseId">
              <td>
                <div>{{ review.caseName }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ COPY.reviewReason[review.reason] }}
                </div>
              </td>
              <td>{{ review.storedBuild }}</td>
              <td>{{ review.suggestedBuild ?? EMPTY_VALUE_PLACEHOLDER }}</td>
              <td style="min-width: 150px">
                <v-select
                  v-model="choices[review.caseId]"
                  :items="buildItems"
                  :aria-label="`${COPY.reviewChoice} of ${review.caseName}`"
                  :disabled="!canWrite"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ COPY.reviewLater }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canWrite || chosen.size === 0"
          :loading="applying"
          @click="applyChoices"
        >
          {{ COPY.reviewApply }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Cases left unrenamed by the chromosome-name migration because their genome
 * build could not be confirmed. The user picks each build; nothing is guessed.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  BUILD_COPY as COPY,
  IMPORTABLE_GENOME_BUILDS
} from '../../../../shared/config/genome-builds.config'
import { EMPTY_VALUE_PLACEHOLDER } from '../../config/displayConfig'
import { useAppState } from '../../composables/useAppState'
import { useBuildReviews } from '../../composables/useBuildReviews'
import { usePermissions } from '../../composables/usePermissions'
import { useDatabaseStore } from '../../stores/databaseStore'

const emit = defineEmits<{ resolved: [] }>()

const { reviews, applying, load, apply } = useBuildReviews()
const { canWrite } = usePermissions()
const { showSnack } = useAppState()
const databaseStore = useDatabaseStore()
const open = ref(false)
const choices = reactive<Record<number, string | null>>({})
const buildItems = IMPORTABLE_GENOME_BUILDS.map((b) => ({ title: b.label, value: b.id }))
const chosen = computed(
  () =>
    new Map(
      reviews.value.flatMap((r) => {
        const build = choices[r.caseId]
        return build === null || build === undefined ? [] : [[r.caseId, build] as const]
      })
    )
)

async function applyChoices(): Promise<void> {
  try {
    const applied = await apply(chosen.value)
    showSnack(COPY.reviewApplied(applied), 'success')
    if (reviews.value.length === 0) open.value = false
  } catch (error) {
    showSnack(error instanceof Error ? error.message : String(error), 'error')
  }
  emit('resolved')
}

onMounted(load)
watch(() => databaseStore.revision, load)
</script>
