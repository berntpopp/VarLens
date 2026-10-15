<script setup lang="ts">
/** Candidate gate of an evidence ranking: which variants are scored, and how many are shown. */
import { computed } from 'vue'
import { useRankingEditor } from '../../composables/useShortlistRankingEditor'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../../shared/config/shortlist-evidence.config'
import type { VariantTypeKey } from '../../../../shared/types/shortlist'

const editor = useRankingEditor()
const { readOnly } = editor
const config = computed(() => editor.draft.value!.config)
const filters = computed(() => config.value.baseFilters)

const GATE_KEYS = new Set(['maxGnomadAf', 'consequences', 'considerPhasing'])
const typeItems: readonly VariantTypeKey[] = SHORTLIST_EVIDENCE_CONFIG.variantTypes

const maxAf = computed({
  get: () => filters.value.maxGnomadAf ?? null,
  set: (v: string | number | null) => {
    filters.value.maxGnomadAf = v === '' || v === null ? null : Number(v)
  }
})
const consequences = computed({
  get: () => filters.value.consequences ?? [],
  set: (v: string[]) => {
    filters.value.consequences = v
  }
})
const considerPhasing = computed({
  get: () => filters.value.considerPhasing === true,
  set: (v: boolean | null) => {
    if (v === true) filters.value.considerPhasing = true
    else delete filters.value.considerPhasing
  }
})
const types = computed({
  get: () => config.value.variantTypeScope ?? [],
  set: (v: VariantTypeKey[]) => {
    config.value.variantTypeScope = v
  }
})
const topN = computed({
  get: () => config.value.topN,
  set: (v: string | number) => {
    config.value.topN = Number(v)
  }
})
// Filters a duplicated or imported preset carries beyond the gate edited here.
const otherFilters = computed(() =>
  Object.entries(filters.value)
    .filter(([k, v]) => !GATE_KEYS.has(k) && v != null && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k)
)
const otherMessages = computed(() =>
  ['baseFilters.inheritanceModes', 'baseFilters.analysisGroupId'].flatMap(editor.messagesAt)
)
</script>

<template>
  <section class="ranking-section" aria-labelledby="ranking-candidates-heading">
    <h3 id="ranking-candidates-heading" class="ranking-section__title">
      {{ COPY.sections.candidates }}
    </h3>
    <p class="ranking-section__help">{{ COPY.sections.candidatesHelp }}</p>
    <div class="gate">
      <v-text-field
        v-model="maxAf"
        type="number"
        min="0"
        max="1"
        :step="COPY.afStep"
        :label="COPY.fields.maxGnomadAf"
        :readonly="readOnly"
        :error-messages="editor.messagesAt('baseFilters.maxGnomadAf')"
        data-problem-key="baseFilters.maxGnomadAf"
        hide-details="auto"
        class="gate__af"
      />
      <v-text-field
        v-model="topN"
        type="number"
        min="1"
        :label="COPY.fields.topN"
        :readonly="readOnly"
        :error-messages="editor.messagesAt('topN')"
        data-problem-key="topN"
        hide-details="auto"
        class="gate__top"
      />
      <div class="gate__chips" data-problem-key="baseFilters.consequences">
        <span id="ranking-impact-label" class="gate__chip-label">{{ COPY.fields.impacts }}</span>
        <v-chip-group
          v-model="consequences"
          multiple
          column
          :disabled="readOnly"
          role="group"
          aria-labelledby="ranking-impact-label"
        >
          <v-chip
            v-for="level in COPY.impactLevels"
            :key="level"
            :value="level"
            size="small"
            label
            filter
            variant="outlined"
          >
            {{ level }}
          </v-chip>
        </v-chip-group>
      </div>
      <div class="gate__chips" data-problem-key="variantTypeScope">
        <span id="ranking-types-label" class="gate__chip-label">{{
          COPY.fields.variantTypes
        }}</span>
        <v-chip-group
          v-model="types"
          multiple
          column
          :disabled="readOnly"
          role="group"
          aria-labelledby="ranking-types-label"
        >
          <v-chip
            v-for="type in typeItems"
            :key="type"
            :value="type"
            size="small"
            label
            filter
            variant="outlined"
          >
            {{ type.toUpperCase() }}
          </v-chip>
        </v-chip-group>
      </div>
    </div>
    <v-switch
      v-model="considerPhasing"
      :label="COPY.fields.considerPhasing"
      :hint="COPY.fields.considerPhasingHint"
      persistent-hint
      :readonly="readOnly"
      density="compact"
      color="primary"
      data-testid="ranking-consider-phasing"
    />
    <div
      v-for="message in [
        ...editor.messagesAt('variantTypeScope'),
        ...editor.messagesAt('baseFilters.consequences'),
        ...otherMessages
      ]"
      :key="message"
      class="text-error text-caption"
      role="alert"
    >
      {{ message }}
    </div>
    <p v-if="otherFilters.length > 0" class="ranking-section__help mt-1">
      {{ COPY.sections.otherFilters }}: <code>{{ otherFilters.join(', ') }}</code>
    </p>
  </section>
</template>

<style scoped src="./ranking-shared.css"></style>

<style scoped>
.gate {
  display: grid;
  grid-template-columns: 120px 96px minmax(0, 1fr) auto;
  gap: 8px 14px;
  align-items: center;
}
.gate__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.gate__chip-label {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
@media (max-width: 900px) {
  .gate {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
