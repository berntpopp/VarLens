<script setup lang="ts">
/**
 * Field-profile table (spec §16): which source fields an import keeps and the
 * `info.<KEY>` each is stored as. Used by the import wizard (JSON and VCF)
 * and by Settings → Import fields for the default profile.
 */
import { computed, ref } from 'vue'
import { mdiMagnify, mdiSigma, mdiStarFourPointsOutline } from '@mdi/js'
import {
  CANONICAL_EVIDENCE_FIELDS,
  KEEP_UNKNOWN_OPTIONS,
  type ImportFieldProfile,
  type KeepUnknownPolicy
} from '../../../../shared/config/import-fields.config'
import type { ImportFieldPreview } from '../../../../shared/types/import'
import { isValidInfoKey } from '../../../../shared/filters/info-field-filter'
import { useSettingsStore } from '../../stores/settingsStore'
import { stripVueProxies } from '../../utils/stripVueProxies'
import {
  fieldRows,
  withAllKept,
  withFieldChoice,
  type FieldRow
} from '../../utils/import-field-rows'

const props = withDefaults(
  defineProps<{
    fields: ImportFieldPreview[]
    readonly?: boolean
    /** Shows "Save as default": these choices become the Settings default (the wizard). */
    canSaveDefault?: boolean
    /** Rows the table area may show before it scrolls. */
    height?: number
  }>(),
  { readonly: false, canSaveDefault: false, height: 300 }
)
const profile = defineModel<ImportFieldProfile>({ required: true })
const settings = useSettingsStore()
const savedDefault = ref(false)
function saveDefault(): void {
  // The wizard's profile starts from the saved default, so it is the whole edited profile:
  // saving it as is keeps removed overrides and cleared renames removed.
  settings.importFieldProfile = stripVueProxies(profile.value)
  savedDefault.value = true
  window.setTimeout(() => (savedDefault.value = false), 3000)
}

const search = ref<string | null>('')
// Keys resolve in source order; the choosable fields are listed before the mapped columns.
const rows = computed(() => {
  const all = fieldRows(props.fields, profile.value)
  return [...all.filter((row) => !row.locked), ...all.filter((row) => row.locked)]
})
const visible = computed(() => {
  const term = (search.value ?? '').trim().toLowerCase()
  if (term === '') return rows.value
  return rows.value.filter((row) =>
    [row.name, row.key, row.column, row.description, row.canonical].some((text) =>
      (text ?? '').toLowerCase().includes(term)
    )
  )
})
const editable = computed(() => visible.value.filter((row) => !row.locked))
const keptCount = computed(() => rows.value.filter((row) => !row.locked && row.keep).length)
const optionalCount = computed(() => rows.value.filter((row) => !row.locked).length)
const columnCount = computed(() => rows.value.length - optionalCount.value)
const filtered = computed(() => (search.value ?? '').trim() !== '')

// A file preview has fill rates and samples; VCF headers and Settings show descriptions.
const sampled = computed(() => props.fields.some((field) => field.fillRate !== null))
const showOrigin = computed(() => new Set(props.fields.map((field) => field.origin)).size > 1)
const headers = computed(() => [
  { title: 'Keep', key: 'keep', width: 44, sortable: false },
  { title: 'Field', key: 'name', width: 220 },
  { title: 'Type', key: 'type', width: 84 },
  ...(sampled.value
    ? [
        { title: 'Fill', key: 'fillRate', width: 52, align: 'end' as const },
        { title: 'Sample values', key: 'samples', sortable: false }
      ]
    : [{ title: 'Description', key: 'description', sortable: false }]),
  { title: 'Stored as', key: 'key', sortable: false, minWidth: 290 }
])

const policy = computed({
  get: () => profile.value.keepUnknown,
  set: (keepUnknown: KeepUnknownPolicy) => {
    profile.value = { ...profile.value, keepUnknown }
  }
})

function setKeep(row: FieldRow, keep: boolean | null): void {
  profile.value = withFieldChoice(profile.value, row, { keep: keep === true, key: row.rename })
}

// A rejected rename: the message shows in the status line, the input re-renders with the old key.
const renameError = ref('')
const inputVersion = ref(0)
function renameProblem(row: FieldRow, key: string): string | null {
  if (!isValidInfoKey(key)) return 'use letters, digits, _ or . and start with a letter or _'
  const evidence = CANONICAL_EVIDENCE_FIELDS.find((field) => field.key === key)
  if (evidence !== undefined && row.canonical !== key) return `reserved for ${evidence.label}`
  const owner = rows.value.find(
    (other) =>
      other.id !== row.id &&
      other.key === key &&
      (other.canonical === null || other.canonical !== row.canonical)
  )
  return owner === undefined ? null : `already used by ${owner.name}`
}
function rename(row: FieldRow, value: string): void {
  const key = value.trim()
  const problem = key === '' ? null : renameProblem(row, key)
  if (problem !== null) {
    renameError.value = `info.${key} not saved for ${row.name}: ${problem}.`
    inputVersion.value += 1
    return
  }
  renameError.value = ''
  // Cleared: back to the automatic key; unchanged: keep the current rename.
  const next = key === '' ? undefined : key === row.key ? row.rename : key
  profile.value = withFieldChoice(profile.value, row, { keep: true, key: next })
}

function setAll(keep: boolean): void {
  profile.value = withAllKept(profile.value, editable.value, keep)
}

function percent(rate: number | null): string {
  return rate === null ? '' : `${Math.round(rate * 100)}%`
}
</script>

<template>
  <div class="field-profile">
    <div class="field-profile__bar">
      <v-text-field
        v-model="search"
        :prepend-inner-icon="mdiMagnify"
        label="Search fields"
        hide-details
        clearable
        class="field-profile__search"
      />
      <v-select
        v-model="policy"
        :items="KEEP_UNKNOWN_OPTIONS"
        item-title="title"
        item-value="value"
        label="Fields without a choice"
        hint="A ticked or cleared box overrides this for its field"
        persistent-hint
        :readonly="readonly"
        class="field-profile__policy"
      />
      <div class="field-profile__actions">
        <v-btn
          size="small"
          variant="text"
          :disabled="readonly || editable.length === 0"
          @click="setAll(true)"
        >
          {{ filtered ? `Keep ${editable.length} shown` : 'Keep all' }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          :disabled="readonly || editable.length === 0"
          @click="setAll(false)"
        >
          {{ filtered ? `Skip ${editable.length} shown` : 'Skip all' }}
        </v-btn>
        <v-btn
          v-if="canSaveDefault"
          size="small"
          variant="tonal"
          color="primary"
          :disabled="readonly"
          data-testid="field-profile-save-default"
          @click="saveDefault"
        >
          {{ savedDefault ? 'Saved to Settings' : 'Save as default' }}
        </v-btn>
      </div>
    </div>
    <div class="field-profile__summary" aria-live="polite">
      <span v-if="renameError" class="field-profile__error">{{ renameError }}</span>
      <template v-else>
        {{ keptCount }} of {{ optionalCount }} optional fields kept
        <template v-if="columnCount > 0">
          · {{ columnCount }} mapped {{ columnCount === 1 ? 'column' : 'columns' }} always imported
        </template>
        <template v-if="filtered">· {{ visible.length }} shown</template>
      </template>
    </div>

    <v-data-table-virtual
      :headers="headers"
      :items="visible"
      item-value="id"
      :height="height"
      fixed-header
      density="compact"
      class="field-profile__table"
      no-data-text="No fields match"
    >
      <template #[`item.keep`]="{ item }">
        <v-checkbox-btn
          :model-value="item.keep"
          :disabled="readonly || item.locked"
          :aria-label="`Keep ${item.name}`"
          density="compact"
          @update:model-value="setKeep(item, $event)"
        />
      </template>
      <template #[`item.name`]="{ item }">
        <div class="field-profile__name" :title="item.description">
          <span v-if="showOrigin" class="field-profile__origin">{{ item.origin }}</span>
          <span class="field-profile__source">{{ item.name }}</span>
        </div>
      </template>
      <template #[`item.fillRate`]="{ item }">{{ percent(item.fillRate) }}</template>
      <template #[`item.samples`]="{ item }">
        <span class="field-profile__clip field-profile__mono">{{ item.samples.join(' · ') }}</span>
      </template>
      <template #[`item.description`]="{ item }">
        <span class="field-profile__clip" :title="item.description">{{ item.description }}</span>
      </template>
      <template #[`item.key`]="{ item }">
        <div v-if="item.locked" class="field-profile__target">
          <span class="field-profile__column-label">column</span>
          <span class="field-profile__mono">{{ item.column }}</span>
          <span
            v-if="item.canonical"
            class="field-profile__hint"
            :title="item.canonicalLabel ?? ''"
          >
            + info.{{ item.canonical }}
          </span>
        </div>
        <div v-else-if="item.keep" class="field-profile__target">
          <span class="field-profile__prefix">info.</span>
          <v-text-field
            :key="`${item.id}:${inputVersion}`"
            :model-value="item.key ?? ''"
            :readonly="readonly"
            :aria-label="`Stored key for ${item.name}`"
            variant="plain"
            hide-details
            class="field-profile__key"
            @change="rename(item, ($event.target as { value: string }).value)"
          />
          <v-tooltip
            v-if="item.canonical === item.key"
            :text="`Evidence key (${item.canonicalLabel}): the same for every source`"
            location="top"
          >
            <template #activator="{ props: tip }">
              <v-icon
                v-bind="tip"
                :icon="mdiStarFourPointsOutline"
                size="14"
                color="primary"
                tabindex="0"
                :aria-label="`Evidence key ${item.canonical}`"
              />
            </template>
          </v-tooltip>
          <v-tooltip
            v-else-if="item.canonical"
            :text="`Also feeds info.${item.canonical} (${item.canonicalLabel})`"
            location="top"
          >
            <template #activator="{ props: tip }">
              <v-icon
                v-bind="tip"
                :icon="mdiSigma"
                size="14"
                color="primary"
                tabindex="0"
                :aria-label="`Also feeds info.${item.canonical}`"
              />
            </template>
          </v-tooltip>
        </div>
        <span v-else class="field-profile__skipped">not imported</span>
      </template>
    </v-data-table-virtual>
  </div>
</template>

<style scoped>
.field-profile__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.field-profile__search {
  flex: 1 1 180px;
}
.field-profile__policy {
  flex: 1 1 220px;
}
.field-profile__actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.field-profile__summary {
  margin: 6px 0 4px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.field-profile__table {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  font-size: 0.8125rem;
}
.field-profile__name {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
  white-space: nowrap;
}
.field-profile__table :deep(td) {
  white-space: nowrap;
}
.field-profile__origin {
  flex: none;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.field-profile__source {
  overflow: hidden;
  text-overflow: ellipsis;
}
.field-profile__clip {
  display: block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.field-profile__mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.field-profile__target {
  display: flex;
  gap: 4px;
  align-items: center;
}
.field-profile__prefix {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}
.field-profile__column-label {
  font-size: 0.6875rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.field-profile__error {
  color: rgb(var(--v-theme-error));
}
.field-profile__key {
  flex: 1 1 auto;
  min-width: 90px;
}
.field-profile__key :deep(.v-field__input) {
  min-height: 26px;
  padding: 2px 4px;
  border-bottom: 1px dashed rgba(var(--v-border-color), 0.4);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}
.field-profile__key :deep(.v-field--focused .v-field__input) {
  border-bottom: 1px solid rgb(var(--v-theme-primary));
}
.field-profile__hint {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 0.6875rem;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
  color: rgb(var(--v-theme-primary));
}
.field-profile__skipped {
  font-size: 0.75rem;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
