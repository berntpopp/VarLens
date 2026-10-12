<script setup lang="ts">
/**
 * A rule condition: the DSL search bar in condition mode with shortlist-scope
 * autocomplete (zygosity, moi, gene hits …). Validation comes from the editor
 * (the shared rule compiler), not from the variant-filter translator.
 */
import { computed, watch } from 'vue'
import DslSearchBar from '../DslSearchBar.vue'
import { useDslSearch } from '../../composables/useDslSearch'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import type { EvidenceProblem } from '../../../../shared/evidence/ruleset-problems'

const props = defineProps<{
  modelValue: string
  label: string
  problems: EvidenceProblem[]
  readonly?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { rawInput, suggestions, applySuggestion } = useDslSearch(() => [], 'shortlist')
rawInput.value = props.modelValue
watch(
  () => props.modelValue,
  (value) => {
    if (value !== rawInput.value) rawInput.value = value
  }
)
watch(rawInput, (value) => {
  if (value !== props.modelValue) emit('update:modelValue', value)
})

const errors = computed(() =>
  props.problems.map((p) => ({
    message: p.position === undefined ? p.message : p.message + COPY.atCharacter(p.position + 1),
    position: p.position ?? 0,
    length: 0
  }))
)
</script>

<template>
  <code v-if="readonly" class="condition-text">{{ modelValue }}</code>
  <DslSearchBar
    v-else
    condition
    :raw-input="rawInput"
    :suggestions="suggestions"
    :is-dsl-mode="false"
    :errors="errors"
    :label="label"
    :placeholder="COPY.conditionPlaceholder"
    @update:raw-input="(value) => (rawInput = value)"
    @select-suggestion="applySuggestion"
  />
</template>

<style scoped>
.condition-text {
  display: block;
  padding: 6px 0;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: none;
}
</style>
