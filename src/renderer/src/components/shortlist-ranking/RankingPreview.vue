<script setup lang="ts">
/** Top rows of the open case under the edited ranking, with the rank change against the saved one. */
import { mdiPlay, mdiRefresh } from '@mdi/js'
import { useRankingEditor } from '../../composables/useShortlistRankingEditor'
import { useRankingPreview } from '../../composables/useRankingPreview'
import { useAppState } from '../../composables/useAppState'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'

const editor = useRankingEditor()
const { selectedCaseId } = useAppState()
const { result, compared, loading, error, stale, run } = useRankingPreview(
  selectedCaseId,
  () => editor.draft.value?.config ?? null,
  () => editor.draft.value?.presetId ?? null,
  COPY.previewRows
)

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`)
const cols = COPY.previewColumns
const arrow = (n: number): string => (n > 0 ? `↑${n}` : n < 0 ? `↓${-n}` : '·')
</script>

<template>
  <section
    class="ranking-section"
    aria-labelledby="ranking-preview-heading"
    data-testid="ranking-preview"
  >
    <div class="d-flex align-center">
      <h3 id="ranking-preview-heading" class="ranking-section__title">
        {{ COPY.sections.preview }}
      </h3>
      <v-spacer />
      <v-btn
        v-if="selectedCaseId !== null"
        size="small"
        variant="tonal"
        :prepend-icon="result ? mdiRefresh : mdiPlay"
        :loading="loading"
        :disabled="editor.problems.value.length > 0"
        data-testid="ranking-preview-run"
        @click="run"
      >
        {{ result ? COPY.actions.rerunPreview : COPY.actions.runPreview }}
      </v-btn>
    </div>
    <p class="ranking-section__help">
      {{ selectedCaseId === null ? COPY.sections.previewNoCase : COPY.sections.previewHelp }}
    </p>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-2">{{
      error
    }}</v-alert>
    <p v-if="stale" class="preview-stale text-caption" role="status">
      {{ COPY.sections.previewStale }}
    </p>
    <v-table
      v-if="result"
      density="compact"
      class="preview-table"
      :class="{ 'preview-table--stale': stale }"
    >
      <thead>
        <tr>
          <th class="text-right">{{ cols.rank }}</th>
          <th>{{ cols.gene }}</th>
          <th>{{ cols.variant }}</th>
          <th class="text-right">{{ cols.points }}</th>
          <th v-if="compared" class="text-right">{{ cols.delta }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in result" :key="row.id">
          <td class="text-right num">{{ row.rank }}</td>
          <td class="gene">{{ row.gene }}</td>
          <td class="variant">{{ row.variant }}</td>
          <td class="text-right num">{{ signed(row.score) }}</td>
          <td
            v-if="compared"
            class="text-right num"
            :class="{
              'delta--up': row.delta !== null && row.delta > 0,
              'delta--down': row.delta !== null && row.delta < 0
            }"
          >
            <span v-if="row.delta === null">{{ COPY.previewNew }}</span>
            <span v-else :aria-label="COPY.deltaLabel(row.delta)">{{ arrow(row.delta) }}</span>
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped src="./ranking-shared.css"></style>

<style scoped>
.preview-table {
  font-size: 0.8125rem;
  background: transparent;
}
.preview-table :deep(th),
.preview-table :deep(td) {
  padding-inline: 6px !important;
}
.preview-table--stale tbody {
  opacity: 0.6;
}
.num {
  font-variant-numeric: tabular-nums;
}
.gene {
  font-style: italic;
  font-weight: 500;
}
.variant {
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  font-size: 0.75rem;
}
.delta--up {
  color: rgb(var(--v-theme-success));
}
.delta--down {
  color: rgb(var(--v-theme-error));
}
.preview-stale {
  margin: 0 0 4px;
  color: rgb(var(--v-theme-warning));
}
</style>
