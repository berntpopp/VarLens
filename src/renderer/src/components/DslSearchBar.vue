<template>
  <div class="dsl-search-bar-wrapper">
    <v-text-field
      ref="textFieldRef"
      v-model="localInput"
      variant="outlined"
      density="compact"
      :placeholder="placeholder"
      :prepend-inner-icon="condition ? undefined : mdiMagnify"
      hide-details="auto"
      :clearable="!condition"
      :error-messages="errorMessages"
      :messages="notApplied && !hasErrors ? NOT_APPLIED_MESSAGE : []"
      class="dsl-search-bar"
      :aria-label="label"
      aria-autocomplete="list"
      :aria-expanded="String(listOpen)"
      :aria-controls="listOpen ? suggestionsId : undefined"
      :aria-activedescendant="activeOptionId"
      :aria-invalid="hasErrors ? 'true' : undefined"
      :class="{
        'dsl-mode': isDslMode,
        'fts-mode': !isDslMode && localInput !== '',
        'dsl-search-bar--condition': condition
      }"
      @update:model-value="onInput"
      @click:clear="onClear"
      @keydown="onKeydown"
      @focus="showMenu = true"
      @blur="onBlur"
    >
      <!-- Append inner: mode indicator -->
      <template v-if="!condition" #append-inner>
        <v-chip v-if="isDslMode" size="x-small" color="primary" variant="tonal" label class="mr-1">
          DSL
        </v-chip>
        <v-chip v-else-if="localInput !== ''" size="x-small" variant="tonal" label class="mr-1">
          Search
        </v-chip>
      </template>
    </v-text-field>

    <!-- Autocomplete dropdown -->
    <v-menu
      v-model="showMenu"
      :activator="textFieldRef?.$el"
      :activator-props="MENU_ACTIVATOR_ARIA_RESET"
      :close-on-content-click="false"
      :open-on-click="false"
      :open-on-arrow="false"
      :capture-focus="false"
      max-height="400"
      width="500"
      offset="4"
      location="bottom start"
    >
      <!-- Focus stays in the input (combobox); options are tracked via aria-activedescendant -->
      <v-list
        v-if="suggestions.length > 0"
        :id="suggestionsId"
        role="listbox"
        tabindex="-1"
        aria-label="Filter suggestions"
        density="compact"
        class="dsl-suggestion-list"
      >
        <template v-for="(item, idx) in groupedSuggestions" :key="idx">
          <v-list-subheader v-if="item.kind === 'header'" class="text-overline" role="presentation">
            {{ item.label }}
          </v-list-subheader>
          <div
            v-else-if="item.kind === 'hint'"
            class="px-4 py-1 text-caption text-medium-emphasis"
            role="presentation"
          >
            {{ item.label }}
            <span v-if="item.description"> — {{ item.description }}</span>
          </div>

          <v-list-item
            v-else
            :id="optionId(item.optionIndex!)"
            role="option"
            :aria-selected="item.optionIndex === highlightedIndex ? 'true' : 'false'"
            :active="item.optionIndex === highlightedIndex"
            @mousedown.prevent="handleSelect(item.suggestion!)"
          >
            <template #prepend>
              <v-icon v-if="item.suggestion!.icon" size="small" class="mr-2">
                {{ item.suggestion!.icon }}
              </v-icon>
            </template>
            <v-list-item-title>
              {{ item.suggestion!.label }}
              <span
                v-if="item.suggestion!.description"
                class="text-caption text-medium-emphasis ml-2"
              >
                {{ item.suggestion!.description }}
              </span>
            </v-list-item-title>
            <template #append>
              <v-chip v-if="item.suggestion!.typeBadge" size="x-small" variant="tonal" label>
                {{ item.suggestion!.typeBadge }}
              </v-chip>
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted, useId } from 'vue'
import type { VTextField } from 'vuetify/components'
import type { Suggestion } from '../dsl/autocomplete'
import { mdiMagnify } from '@mdi/js'

// The suggestion menu is anchored to the field wrapper <div>; VMenu would put
// menu-button ARIA (aria-haspopup/expanded/owns) on it, which a div may not
// carry (axe: aria-allowed-attr). The input itself is named via aria-label.
const MENU_ACTIVATOR_ARIA_RESET = {
  'aria-haspopup': null,
  'aria-expanded': null,
  'aria-controls': null,
  'aria-owns': null
}
const suggestionsId = `dsl-suggestions-${useId()}`

interface Props {
  rawInput: string
  suggestions: Suggestion[]
  isDslMode: boolean
  errors: { message: string; position: number; length: number }[]
  /** The text differs from the applied (committed) filter */
  notApplied?: boolean
  placeholder?: string
  /** Accessible name of the input. */
  label?: string
  /**
   * Edit a single rule condition (shortlist ranking editor) instead of searching:
   * no search icon, mode chip or clear button, and messages flow under the field.
   */
  condition?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Gene, chr:pos, or filter expression (e.g. gnomad_af:<:0.01)',
  label: 'Search variants (text or filter DSL)',
  condition: false
})

const emit = defineEmits<{
  'update:rawInput': [value: string]
  apply: []
  clear: []
  'select-suggestion': [suggestion: Suggestion]
}>()

const textFieldRef = ref<InstanceType<typeof VTextField> | null>(null)
const showMenu = ref(false)

/** Local input model synced with parent rawInput */
const localInput = ref(props.rawInput)

watch(
  () => props.rawInput,
  (val) => {
    localInput.value = val
  }
)

const hasErrors = computed(() => props.errors.length > 0)
const NOT_APPLIED_MESSAGE = ['Not applied — press Enter to apply']
/** Shown persistently below the field (VField links them via aria-describedby) */
const errorMessages = computed(() => props.errors.map((e) => e.message))

interface GroupedItem {
  kind: 'header' | 'hint' | 'option'
  label?: string
  description?: string
  suggestion?: Suggestion
  /** Index among selectable options (kind 'option' only) */
  optionIndex?: number
}

const HEADER_LABELS: Record<string, string> = {
  column: 'FIELDS',
  operator: 'OPERATORS',
  value: 'VALUES',
  combinator: 'COMBINE WITH',
  preset: 'PRESETS'
}

/** Suggestions with category headers; hints are text, not selectable options */
const groupedSuggestions = computed((): GroupedItem[] => {
  const items: GroupedItem[] = []
  let lastCategory = ''
  let optionIndex = 0
  for (const s of props.suggestions) {
    if (s.category === 'hint') {
      items.push({ kind: 'hint', label: s.label, description: s.description })
      continue
    }
    if (s.category !== lastCategory) {
      items.push({ kind: 'header', label: HEADER_LABELS[s.category] ?? s.category.toUpperCase() })
      lastCategory = s.category
    }
    items.push({ kind: 'option', suggestion: s, optionIndex: optionIndex++ })
  }
  return items
})

const highlightedIndex = ref(-1)

const selectableSuggestions = computed(() => props.suggestions.filter((s) => s.category !== 'hint'))

const listOpen = computed(() => showMenu.value && props.suggestions.length > 0)

const optionId = (index: number): string => `${suggestionsId}-option-${index}`

const activeOptionId = computed(() =>
  listOpen.value && highlightedIndex.value >= 0 ? optionId(highlightedIndex.value) : undefined
)

watch(
  () => props.suggestions,
  () => {
    highlightedIndex.value = -1
  }
)

function onInput(value: string | null): void {
  const v = value ?? ''
  emit('update:rawInput', v)
  showMenu.value = v.length > 0 || props.suggestions.length > 0
  // When user deletes all text, clear any active DSL filters
  if (v === '') {
    emit('clear')
  }
}

function onEnter(): void {
  showMenu.value = false
  emit('apply')
}

/** Move the highlighted option, opening the list if needed */
function moveHighlight(event: KeyboardEvent, step: 1 | -1): void {
  const count = selectableSuggestions.value.length
  if (count === 0) return
  event.preventDefault()
  if (!showMenu.value) showMenu.value = true
  highlightedIndex.value = (highlightedIndex.value + step + count) % count
}

/** The option the keyboard highlight is on, if the list is open */
function activeSuggestion(): Suggestion | undefined {
  return listOpen.value ? selectableSuggestions.value[highlightedIndex.value] : undefined
}

// Single keydown handler: two @keydown.<modifier> bindings on one element
// trip vue-tsc TS1117 against Vuetify 4.1+ types (vuejs/language-tools#6096).
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'ArrowDown') {
    moveHighlight(event, 1)
  } else if (event.key === 'ArrowUp') {
    moveHighlight(event, -1)
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    const active = activeSuggestion()
    if (active) {
      event.preventDefault()
      handleSelect(active)
    } else if (event.key === 'Enter') {
      onEnter()
    }
  } else if (event.key === 'Escape' && listOpen.value) {
    // Dismiss the list only; focus stays in the input
    event.preventDefault()
    event.stopPropagation()
    showMenu.value = false
    highlightedIndex.value = -1
  }
}

function onClear(): void {
  localInput.value = ''
  emit('update:rawInput', '')
  emit('clear')
  showMenu.value = false
}

let blurTimeout: ReturnType<typeof setTimeout> | null = null

function onBlur(): void {
  // Delay to allow click on suggestion to fire first
  blurTimeout = globalThis.setTimeout(() => {
    showMenu.value = false
  }, 200)
}

onBeforeUnmount(() => {
  if (blurTimeout !== null) {
    clearTimeout(blurTimeout)
  }
})

function handleSelect(suggestion: Suggestion): void {
  highlightedIndex.value = -1
  emit('select-suggestion', suggestion)
  showMenu.value = true
}

function inputEl(): HTMLInputElement | null {
  return (textFieldRef.value?.$el?.querySelector('input') as HTMLInputElement | null) ?? null
}

// VTextField's `role` prop lands on both the field wrapper and the input; the
// combobox must be the input alone, so set it there directly.
onMounted(() => inputEl()?.setAttribute('role', 'combobox'))

/** Expose focus method for keyboard shortcut */
function focus(): void {
  inputEl()?.focus()
}

defineExpose({ focus })
</script>

<style scoped>
.dsl-search-bar-wrapper {
  flex-grow: 1;
  max-width: 100%;
  position: relative;
}

.dsl-search-bar :deep(.v-field) {
  border-radius: 6px;
}

/* Errors and the "not applied" note float below the field: the toolbars have a
   fixed height, so in-flow messages would squeeze the input and be clipped. */
.dsl-search-bar :deep(.v-input__details) {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 5;
  min-height: 0;
  margin-top: 2px;
  padding: 4px 8px;
  border: 1px solid rgb(var(--v-theme-warning));
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 6px rgb(0 0 0 / 15%);
}

/* A condition in an editor row has room below it: keep its message in flow. */
.dsl-search-bar--condition :deep(.v-input__details) {
  position: static;
  margin-top: 0;
  padding: 2px 0 0;
  border: 0;
  box-shadow: none;
  background: none;
}

.dsl-search-bar.v-input--error :deep(.v-input__details) {
  border-color: rgb(var(--v-theme-error));
}

.dsl-search-bar :deep(.v-messages) {
  min-height: 0;
  overflow: visible;
  white-space: normal;
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

.dsl-suggestion-list {
  max-height: 400px;
  overflow-y: auto;
}

.dsl-suggestion-list :deep(.v-list-item--active) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent) !important;
  font-weight: 500;
}

/* Hide mode badge at narrow widths to save space */
@media (max-width: 600px) {
  .dsl-search-bar :deep(.v-field__append-inner .v-chip) {
    display: none;
  }
}
</style>

<style>
/* Let the floating messages above leave the fixed-height toolbar row. */
.v-toolbar__content:has(.dsl-search-bar-wrapper) {
  overflow-x: clip;
  overflow-y: visible;
}
</style>
