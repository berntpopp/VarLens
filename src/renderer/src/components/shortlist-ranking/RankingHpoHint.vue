<template>
  <v-alert
    v-if="usesHpo && status !== null && (!status.installed || status.needsUpdate)"
    type="warning"
    variant="tonal"
    density="compact"
    class="mb-2 text-body-2"
    data-testid="ranking-hpo-missing"
  >
    {{ COPY.hpoDataMissing }}
  </v-alert>
</template>

<script setup lang="ts">
// hpo_resnik silently stays null without HPO data (#600): say so where rules are written.
import { computed, onMounted, ref } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { logService } from '../../services/LogService'
import { formatError } from '../../utils/ipc-result'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import { compileRule } from '../../../../shared/dsl/evaluate'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import type { EvidenceRuleset } from '../../../../shared/types/evidence-ruleset'
import type { HpoDataStatus } from '../../../../shared/types/hpo-data'

const props = defineProps<{ ruleset: EvidenceRuleset | undefined }>()

const { api } = useApiService()
const status = ref<HpoDataStatus | null>(null)

const usesHpo = computed(() =>
  [
    ...(props.ruleset?.modes ?? []).map((m) => m.when),
    ...(props.ruleset?.groups ?? []).flatMap((g) => g.rules.map((r) => r.when))
  ].some((text) => {
    if (text === null) return false
    const result = compileRule(text)
    return result.ok && result.columns.has('hpo_resnik')
  })
)

onMounted(async () => {
  try {
    status.value = api ? unwrapIpcResult(await api.hpoData.status()) : null
  } catch (e) {
    logService.warn(`Failed to load HPO data status: ${formatError(e)}`, 'hpo-data')
  }
})
</script>
