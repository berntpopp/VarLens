<template>
  <div class="dsl-search-bar-wrapper">
    <v-text-field
      ref="textFieldRef"
      v-model="localInput"
      variant="outlined"
      density="compact"
      :placeholder="placeholder"
      prepend-inner-icon="mdi-magnify"
      hide-details
      clearable
      :error="hasErrors"
      class="dsl-search-bar"
      :class="{ 'dsl-mode': isDslMode, 'fts-mode': !isDslMode && localInput !== '' }"
      @update:model-value="onInput"
      @click:clear="onClear"
      @keydown.enter="onEnter"
      @keydown.escape="($event.target as HTMLElement)?.blur()"
      @focus="showMenu = true"
      @blur="onBlur"
    >
      <!-- Append inner: mode indicator -->
      <template #append-inner>
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
      :close-on-content-click="false"
      :open-on-click="false"
      max-height="400"
      width="500"
      offset="4"
      location="bottom start"
    >
      <v-list v-if="suggestions.length > 0" density="compact" class="dsl-suggestion-list">
        <template v-for="(item, idx) in groupedSuggestions" :key="idx">
          <!-- Category header -->
          <v-list-subheader v-if="item.isHeader" class="text-overline">
            {{ item.headerLabel }}
          </v-list-subheader>

          <!-- Suggestion item -->
          <v-list-item v-else @mousedown.prevent="handleSelect(item.suggestion!)">
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

    <!-- Error tooltip (shown on hover when there are parse errors) -->
    <v-tooltip
      v-if="hasErrors"
      :text="errors[0]?.message"
      location="bottom"
      :activator="textFieldRef?.$el"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { VTextField } from 'vuetify/components'
import type { Suggestion } from '../dsl/autocomplete'

interface Props {
  rawInput: string
  suggestions: Suggestion[]
  isDslMode: boolean
  errors: { message: string; position: number; length: number }[]
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

interface GroupedItem {
  isHeader: boolean
  headerLabel?: string
  suggestion?: Suggestion
}

/** Format suggestions with category headers for the dropdown */
const groupedSuggestions = computed((): GroupedItem[] => {
  const items: GroupedItem[] = []
  let lastCategory = ''

  const headerLabels: Record<string, string> = {
    column: 'COLUMNS',
    operator: 'OPERATORS',
    value: 'VALUES',
    combinator: 'COMBINE WITH',
    preset: 'PRESETS'
  }

  for (const s of props.suggestions) {
    if (s.category !== lastCategory && s.category !== 'hint') {
      items.push({
        isHeader: true,
        headerLabel: headerLabels[s.category] ?? s.category.toUpperCase()
      })
      lastCategory = s.category
    }
    items.push({ isHeader: false, suggestion: s })
  }
  return items
})

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

function onClear(): void {
  localInput.value = ''
  emit('update:rawInput', '')
  emit('clear')
  showMenu.value = false
}

function onBlur(): void {
  // Delay to allow click on suggestion to fire first

  globalThis.setTimeout(() => {
    showMenu.value = false
  }, 200)
}

function handleSelect(suggestion: Suggestion): void {
  emit('select-suggestion', suggestion)
  showMenu.value = true
}

/** Expose focus method for keyboard shortcut */
function focus(): void {
  const input = textFieldRef.value?.$el?.querySelector('input') as HTMLInputElement | null
  input?.focus()
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

/* Hide mode badge at narrow widths to save space */
@media (max-width: 600px) {
  .dsl-search-bar :deep(.v-field__append-inner .v-chip) {
    display: none;
  }
}
</style>
