<script setup lang="ts">
/**
 * Inheritance modes in their fixed decision-list order: the first matching
 * mode applies; fallback is last and has no condition.
 */
import { useRankingEditor, RULESET_PATH } from '../../composables/useShortlistRankingEditor'
import RankingConditionInput from './RankingConditionInput.vue'
import RankingPointsInput from './RankingPointsInput.vue'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../../shared/config/shortlist-evidence.config'

const editor = useRankingEditor()
const { readOnly } = editor
const key = (i: number): string => [...RULESET_PATH, 'modes', i].join('.')
const { modes: modeCopy } = SHORTLIST_EVIDENCE_CONFIG
</script>

<template>
  <section class="ranking-section" aria-labelledby="ranking-modes-heading">
    <h3 id="ranking-modes-heading" class="ranking-section__title">{{ COPY.sections.modes }}</h3>
    <p class="ranking-section__help">{{ COPY.sections.modesHelp }}</p>
    <div
      v-for="message in editor.messagesAt([...RULESET_PATH, 'modes'].join('.'))"
      :key="message"
      class="text-error text-caption"
    >
      {{ message }}
    </div>
    <ol class="mode-list">
      <li
        v-for="(mode, i) in editor.ruleset.value!.modes"
        :key="mode.id"
        class="mode-row"
        :data-problem-key="key(i)"
      >
        <span class="mode-row__index text-medium-emphasis" aria-hidden="true">{{ i + 1 }}</span>
        <div class="mode-row__name">
          <div class="mode-row__label">{{ mode.label }}</div>
          <div class="mode-row__help text-medium-emphasis">{{ modeCopy[mode.id].help }}</div>
        </div>
        <RankingConditionInput
          v-if="mode.when !== null"
          v-model="mode.when"
          :label="`${mode.label} — ${COPY.fields.condition}`"
          :problems="editor.problemsAt(`${key(i)}.when`)"
          :readonly="readOnly"
          :data-problem-key="`${key(i)}.when`"
        />
        <span v-else class="mode-row__fixed text-medium-emphasis">{{
          COPY.fallbackCondition
        }}</span>
        <RankingPointsInput
          v-model="mode.points"
          :label="`${mode.label} — ${COPY.fields.points}`"
          :error-messages="editor.messagesAt(`${key(i)}.points`)"
          :readonly="readOnly"
          :data-problem-key="`${key(i)}.points`"
        />
      </li>
    </ol>
  </section>
</template>

<style scoped src="./ranking-shared.css"></style>

<style scoped>
.mode-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.mode-row {
  display: grid;
  grid-template-columns: 16px minmax(150px, 0.9fr) minmax(200px, 2.2fr) 76px;
  gap: 8px;
  align-items: start;
  padding: 4px 0;
}
.mode-row + .mode-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.mode-row__index {
  padding-top: 7px;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.mode-row__name {
  padding-top: 5px;
  min-width: 0;
}
.mode-row__label {
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.3;
}
.mode-row__help {
  font-size: 0.75rem;
  line-height: 1.3;
}
.mode-row__fixed {
  padding-top: 7px;
  font-size: 0.8125rem;
  font-style: italic;
}
</style>
