<template>
  <!--
    IMPORTANT: v-combobox selection race condition prevention:
    - :return-object="false" prevents Vuetify from setting model to the item object
    - :auto-select-first="false" prevents auto-highlighting
    - :no-filter="true" disables Vuetify's internal filtering (our autocomplete handles it)
    - We intercept selection via @update:model-value and prevent the default by
      immediately resetting the model to the rawInput value after applySuggestion runs
  -->
  <v-combobox
    ref="comboboxRef"
    v-model="inputModel"
    :items="formattedSuggestions"
    :menu-props="{ maxHeight: 400, width: 500 }"
    variant="outlined"
    density="compact"
    :placeholder="placeholder"
    prepend-inner-icon="mdi-magnify"
    hide-details
    clearable
    :return-object="false"
    :auto-select-first="false"
    :no-filter="true"
    :error="hasErrors"
    class="dsl-search-bar"
    :class="{ 'dsl-mode': isDslMode, 'fts-mode': !isDslMode && rawInput !== '' }"
    @update:search="onSearchInput"
    @click:clear="onClear"
    @keydown.enter="onEnter"
  >
    <!-- Custom dropdown item rendering -->
    <template #item="{ item, props: itemProps }">
      <!-- Category header -->
      <v-list-subheader v-if="(item.raw as SuggestionItem).isHeader === true" class="text-overline">
        {{ (item.raw as SuggestionItem).title }}
      </v-list-subheader>

      <!-- Suggestion item -->
      <v-list-item v-else v-bind="itemProps" @click="handleSelect(item.raw as SuggestionItem)">
        <template #prepend>
          <v-icon v-if="(item.raw as SuggestionItem).icon" size="small" class="mr-2">{{
            (item.raw as SuggestionItem).icon
          }}</v-icon>
        </template>
        <v-list-item-title>
          {{ (item.raw as SuggestionItem).label }}
          <span
            v-if="(item.raw as SuggestionItem).description"
            class="text-caption text-medium-emphasis ml-2"
          >
            {{ (item.raw as SuggestionItem).description }}
          </span>
        </v-list-item-title>
        <template #append>
          <v-chip
            v-if="(item.raw as SuggestionItem).typeBadge"
            size="x-small"
            variant="tonal"
            label
          >
            {{ (item.raw as SuggestionItem).typeBadge }}
          </v-chip>
        </template>
      </v-list-item>
    </template>

    <!-- Append inner: mode indicator -->
    <template #append-inner>
      <v-chip v-if="isDslMode" size="x-small" color="primary" variant="tonal" label class="mr-1">
        DSL
      </v-chip>
      <v-chip v-else-if="rawInput !== ''" size="x-small" variant="tonal" label class="mr-1">
        Search
      </v-chip>
    </template>
  </v-combobox>

  <!-- Error display -->
  <div v-if="hasErrors" class="dsl-error-bar px-3 py-1">
    <v-icon size="x-small" color="error" class="mr-1">mdi-alert-circle</v-icon>
    <span class="text-caption text-error">{{ errors[0]?.message }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Suggestion } from '../dsl/autocomplete'

/** Item shape in the formatted suggestions list */
interface SuggestionItem extends Record<string, unknown> {
  isHeader?: boolean
  title?: string
  label?: string
  description?: string
  icon?: string
  typeBadge?: string
  value?: string
  category?: string
}

interface Props {
  /** Reactive raw input from useDslSearch */
  rawInput: string
  /** Suggestions from useDslSearch */
  suggestions: Suggestion[]
  /** Whether the input is in DSL mode */
  isDslMode: boolean
  /** Parse errors */
  errors: { message: string; position: number; length: number }[]
  /** Placeholder text */
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Gene, chr:pos, or filter expression (e.g. gnomad_af:<:0.01)'
})

const emit = defineEmits<{
  'update:rawInput': [value: string]
  apply: []
  clear: []
  'select-suggestion': [suggestion: Suggestion]
}>()

const comboboxRef = ref<HTMLElement | null>(null)

const inputModel = computed({
  get: () => props.rawInput,
  set: (val) => emit('update:rawInput', val ?? '')
})

const hasErrors = computed(() => props.errors.length > 0)

/** Format suggestions with category headers for the dropdown */
const formattedSuggestions = computed(() => {
  const items: Array<Record<string, unknown>> = []
  let lastCategory = ''

  for (const s of props.suggestions) {
    if (s.category !== lastCategory && s.category !== 'hint') {
      const headerLabels: Record<string, string> = {
        column: 'COLUMNS',
        operator: 'OPERATORS',
        value: 'VALUES',
        combinator: 'COMBINE WITH',
        preset: 'PRESETS'
      }
      items.push({
        isHeader: true,
        title: headerLabels[s.category] ?? s.category.toUpperCase(),
        value: `__header_${s.category}`
      })
      lastCategory = s.category
    }
    items.push({
      ...s,
      title: s.label,
      value: s.value
    })
  }
  return items
})

function onSearchInput(value: string | null): void {
  emit('update:rawInput', value ?? '')
}

function onEnter(): void {
  emit('apply')
}

function onClear(): void {
  emit('clear')
}

function handleSelect(item: SuggestionItem): void {
  if (item.isHeader === true) return
  emit('select-suggestion', item as unknown as Suggestion)
}

/** Expose focus method for keyboard shortcut */
function focus(): void {
  const input = (comboboxRef.value as HTMLElement | null)?.querySelector(
    'input'
  ) as HTMLInputElement | null
  input?.focus()
}

defineExpose({ focus })
</script>

<style scoped>
.dsl-search-bar {
  flex-grow: 1;
  max-width: 100%;
}

.dsl-search-bar :deep(.v-field) {
  border-radius: 6px;
}

.dsl-search-bar.dsl-mode :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 4%, transparent);
}

.dsl-search-bar.fts-mode :deep(.v-field--focused) {
  box-shadow: 0 0 0 2px color-mix(in srgb, rgb(var(--v-theme-primary)) 15%, transparent);
}

.dsl-search-bar :deep(.v-field__input) {
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  font-size: 0.85rem;
}

.dsl-error-bar {
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 8%, transparent);
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}
</style>
