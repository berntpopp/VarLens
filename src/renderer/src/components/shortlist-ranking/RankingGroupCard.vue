<script setup lang="ts">
/**
 * One evidence group as a collapsible panel: its decision list of rules
 * (first match wins), the reference rule last, plus label and scope.
 * Must sit inside `v-expansion-panels`.
 */
import { computed } from 'vue'
import { mdiAlertCircleOutline, mdiDeleteOutline, mdiPlus } from '@mdi/js'
import RankingRuleRow from './RankingRuleRow.vue'
import { useRankingEditor, RULESET_PATH } from '../../composables/useShortlistRankingEditor'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import { SHORTLIST_EVIDENCE_CONFIG } from '../../../../shared/config/shortlist-evidence.config'

const props = defineProps<{ groupIndex: number }>()

const editor = useRankingEditor()
const { readOnly } = editor
const group = computed(() => editor.ruleset.value!.groups[props.groupIndex])
const key = computed(() => [...RULESET_PATH, 'groups', props.groupIndex].join('.'))
const problemCount = computed(() => editor.problemCountUnder(key.value))

const modeLabel = (id: string): string =>
  SHORTLIST_EVIDENCE_CONFIG.modes[id as keyof typeof SHORTLIST_EVIDENCE_CONFIG.modes]?.label ?? id
const scopeItems = computed(() => [
  { value: 'global', title: COPY.scopeGlobal },
  ...editor.ruleset.value!.modes.map((m) => ({ value: m.id, title: modeLabel(m.id) }))
])
const scopeLabel = computed(() =>
  group.value.scope === 'global' ? COPY.scopeGlobal : modeLabel(group.value.scope)
)
</script>

<template>
  <v-expansion-panel :value="groupIndex" :data-problem-key="key" data-testid="ranking-group">
    <v-expansion-panel-title class="group-title">
      <span class="group-title__label">{{ group.label }}</span>
      <span class="group-title__meta text-medium-emphasis">
        {{ scopeLabel }} · {{ COPY.ruleCount(group.rules.length) }}
      </span>
      <v-chip
        v-if="problemCount > 0"
        size="x-small"
        color="error"
        variant="tonal"
        label
        :prepend-icon="mdiAlertCircleOutline"
        class="ml-2"
      >
        {{ COPY.errors.count(problemCount) }}
      </v-chip>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div v-if="!readOnly" class="group-fields">
        <v-text-field
          v-model="group.label"
          :label="COPY.fields.label"
          :error-messages="editor.messagesAt(`${key}.label`)"
          :data-problem-key="`${key}.label`"
          hide-details="auto"
        />
        <v-select
          v-model="group.scope"
          :items="scopeItems"
          :label="COPY.fields.scope"
          :error-messages="editor.messagesAt(`${key}.scope`)"
          :data-problem-key="`${key}.scope`"
          hide-details="auto"
        />
        <v-btn
          variant="text"
          size="small"
          color="error"
          :prepend-icon="mdiDeleteOutline"
          @click="editor.removeGroup(groupIndex)"
        >
          {{ COPY.actions.removeGroup }}
        </v-btn>
      </div>
      <div
        v-for="message in editor.messagesAt(`${key}.rules`)"
        :key="message"
        class="text-error text-caption"
      >
        {{ message }}
      </div>
      <div class="rule-head text-medium-emphasis" aria-hidden="true">
        <span />
        <span>{{ COPY.fields.label }}</span>
        <span>{{ COPY.fields.condition }}</span>
        <span class="text-right">{{ COPY.fields.points }}</span>
      </div>
      <RankingRuleRow
        v-for="(rule, ri) in group.rules"
        :key="rule.id"
        :group-index="groupIndex"
        :rule-index="ri"
      />
      <v-btn
        v-if="!readOnly"
        variant="text"
        size="small"
        :prepend-icon="mdiPlus"
        class="mt-1"
        data-testid="rule-add"
        @click="editor.addRule(groupIndex)"
      >
        {{ COPY.actions.addRule }}
      </v-btn>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.group-title {
  min-height: 36px;
  padding-block: 6px;
  font-size: 0.8125rem;
}
.group-title__label {
  font-weight: 600;
}
.group-title__meta {
  margin-left: 10px;
  font-size: 0.75rem;
}
.group-fields {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto;
  gap: 8px;
  align-items: start;
  margin-bottom: 8px;
}
.rule-head {
  display: grid;
  grid-template-columns: 52px minmax(120px, 0.9fr) minmax(200px, 2.2fr) 76px 28px;
  gap: 6px;
  font-size: 0.6875rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
</style>
