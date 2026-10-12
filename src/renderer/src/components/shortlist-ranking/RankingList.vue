<script setup lang="ts">
/**
 * Left pane of the ranking dialog: the shortlist rankings (built-ins locked),
 * New / Import / Export, and the default ranking of the Shortlist tab.
 * Selection changes are emitted so the dialog can guard unsaved edits.
 */
import { computed, ref } from 'vue'
import { mdiExport, mdiImport, mdiLockOutline, mdiPlus } from '@mdi/js'
import { useRankingEditor, isEvidencePreset } from '../../composables/useShortlistRankingEditor'
import { useSettingsStore } from '../../stores/settingsStore'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'

defineProps<{ canWrite: boolean }>()
const emit = defineEmits<{
  select: [id: number]
  new: []
  import: [text: string]
  export: []
}>()

const editor = useRankingEditor()
const settings = useSettingsStore()
const fileInput = ref<HTMLInputElement | null>(null)

const unsavedDraft = computed(() => editor.selectedId.value === null && editor.draft.value !== null)
const defaultItems = computed(() => [
  { value: null, title: COPY.defaultRanking.none },
  ...editor.rankings.value.map((p) => ({ value: p.id, title: p.name }))
])

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('import', await file.text())
}
</script>

<template>
  <nav class="ranking-list" :aria-label="COPY.listHeading">
    <h3 class="ranking-list__heading">{{ COPY.listHeading }}</h3>
    <v-list density="compact" nav class="ranking-list__items" data-testid="ranking-list">
      <v-list-item
        v-if="unsavedDraft"
        :title="editor.draft.value!.name"
        :subtitle="COPY.labels.unsaved"
        active
        rounded
      />
      <v-list-item
        v-for="preset in editor.rankings.value"
        :key="preset.id"
        :title="preset.name"
        :subtitle="isEvidencePreset(preset) ? COPY.labels.evidence : COPY.labels.legacy"
        :active="preset.id === editor.selectedId.value"
        rounded
        @click="emit('select', preset.id)"
      >
        <template v-if="preset.isBuiltIn" #append>
          <v-icon
            :icon="mdiLockOutline"
            size="14"
            :aria-label="COPY.labels.builtIn"
            :data-tooltip="COPY.labels.builtIn"
          />
        </template>
      </v-list-item>
    </v-list>
    <div class="ranking-list__actions">
      <v-btn
        v-if="canWrite"
        size="small"
        variant="tonal"
        :prepend-icon="mdiPlus"
        data-testid="ranking-new"
        @click="emit('new')"
      >
        {{ COPY.actions.newRanking }}
      </v-btn>
      <v-btn
        v-if="canWrite"
        size="small"
        variant="text"
        :prepend-icon="mdiImport"
        @click="fileInput?.click()"
      >
        {{ COPY.actions.importRanking }}
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :prepend-icon="mdiExport"
        :disabled="editor.draft.value === null"
        @click="emit('export')"
      >
        {{ COPY.actions.exportRanking }}
      </v-btn>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="ranking-import-file"
        @change="onFile"
      />
    </div>
    <v-select
      v-model="settings.defaultShortlistPresetId"
      :items="defaultItems"
      :label="COPY.defaultRanking.label"
      :hint="COPY.defaultRanking.hint"
      persistent-hint
      class="mt-3"
      data-testid="ranking-default"
    />
  </nav>
</template>

<style scoped>
.ranking-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 10px 12px;
}
.ranking-list__heading {
  margin: 0 0 4px 8px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.ranking-list__items {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  background: transparent;
}
.ranking-list__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
