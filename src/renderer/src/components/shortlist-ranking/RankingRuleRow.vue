<script setup lang="ts">
/**
 * One rule of an evidence group: order buttons, label, condition, points,
 * remove. The group's reference rule is pinned last: it neither moves nor is
 * removed and always scores 0.
 */
import { computed } from 'vue'
import { mdiChevronDown, mdiChevronUp, mdiClose, mdiPin } from '@mdi/js'
import IconButton from '../common/IconButton.vue'
import RankingConditionInput from './RankingConditionInput.vue'
import RankingPointsInput from './RankingPointsInput.vue'
import { useRankingEditor, RULESET_PATH } from '../../composables/useShortlistRankingEditor'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import { isReferenceRule } from '../../../../shared/evidence/ruleset-problems'

const props = defineProps<{ groupIndex: number; ruleIndex: number }>()

const editor = useRankingEditor()
const { readOnly } = editor
const rule = computed(() => editor.ruleset.value!.groups[props.groupIndex].rules[props.ruleIndex])
const reference = computed(() => isReferenceRule(rule.value))
const key = computed(() =>
  [...RULESET_PATH, 'groups', props.groupIndex, 'rules', props.ruleIndex].join('.')
)
// Row-level problems: a misplaced reference rule, a duplicate id.
const rowMessages = computed(() => [
  ...editor.messagesAt(key.value),
  ...editor.messagesAt(`${key.value}.id`)
])
const name = (field: string): string => `${rule.value.label} — ${field}`
</script>

<template>
  <div
    class="rule-row"
    :class="{ 'rule-row--reference': reference }"
    :data-problem-key="key"
    data-testid="ranking-rule-row"
  >
    <div class="rule-row__order">
      <span v-if="reference" class="rule-row__pin" :data-tooltip="COPY.labels.reference">
        <v-icon :icon="mdiPin" size="14" aria-hidden="true" />
        <span class="visually-hidden">{{ COPY.labels.reference }}</span>
      </span>
      <template v-else-if="!readOnly">
        <IconButton
          :label="COPY.actions.moveUp"
          :icon="mdiChevronUp"
          size="x-small"
          :disabled="!editor.canMoveRule(groupIndex, ruleIndex, -1)"
          data-testid="rule-move-up"
          @click="editor.moveRule(groupIndex, ruleIndex, -1)"
        />
        <IconButton
          :label="COPY.actions.moveDown"
          :icon="mdiChevronDown"
          size="x-small"
          :disabled="!editor.canMoveRule(groupIndex, ruleIndex, 1)"
          data-testid="rule-move-down"
          @click="editor.moveRule(groupIndex, ruleIndex, 1)"
        />
      </template>
    </div>
    <span v-if="readOnly" class="rule-row__label-text">{{ rule.label }}</span>
    <v-text-field
      v-else
      v-model="rule.label"
      :aria-label="name(COPY.fields.label)"
      :error-messages="editor.messagesAt(`${key}.label`)"
      :data-problem-key="`${key}.label`"
      hide-details="auto"
    />
    <RankingConditionInput
      v-model="rule.when"
      :label="name(COPY.fields.condition)"
      :problems="editor.problemsAt(`${key}.when`)"
      :readonly="readOnly"
      :data-problem-key="`${key}.when`"
    />
    <RankingPointsInput
      v-model="rule.points"
      :label="name(COPY.fields.points)"
      :error-messages="editor.messagesAt(`${key}.points`)"
      :readonly="readOnly"
      :data-problem-key="`${key}.points`"
    />
    <div class="rule-row__remove">
      <IconButton
        v-if="!readOnly && !reference"
        :label="COPY.actions.removeRule"
        :icon="mdiClose"
        size="x-small"
        data-testid="rule-remove"
        @click="editor.removeRule(groupIndex, ruleIndex)"
      />
    </div>
    <div v-if="rowMessages.length > 0" class="rule-row__messages text-error" role="alert">
      {{ rowMessages.join('; ') }}
    </div>
  </div>
</template>

<style scoped>
.rule-row {
  display: grid;
  grid-template-columns: 52px minmax(120px, 0.9fr) minmax(200px, 2.2fr) 76px 28px;
  gap: 6px;
  align-items: start;
  padding: 3px 0;
}
.rule-row--reference {
  border-top: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  padding-top: 6px;
}
.rule-row__order,
.rule-row__remove {
  display: flex;
  align-items: center;
  min-height: 32px;
}
.rule-row__pin {
  display: inline-flex;
  padding-left: 4px;
  color: rgb(var(--v-theme-on-surface));
  opacity: var(--v-medium-emphasis-opacity);
}
.rule-row__label-text {
  padding: 6px 0;
  font-size: 0.8125rem;
  line-height: 1.35;
}
.rule-row--reference .rule-row__label-text,
.rule-row--reference :deep(.v-field__input) {
  font-style: italic;
}
.rule-row__messages {
  grid-column: 2 / -1;
  font-size: 0.75rem;
}
</style>
