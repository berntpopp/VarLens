<script setup lang="ts">
/**
 * Settings → Shortlist ranking (spec §12): the list of shortlist rankings on
 * the left, the evidence-ranking editor on the right, problems and Save in
 * the footer. Logic lives in `useShortlistRankingEditor`; the sections inject it.
 */
import { nextTick, provide, ref, watch } from 'vue'
import {
  mdiAlertCircleOutline,
  mdiClose,
  mdiContentCopy,
  mdiDeleteOutline,
  mdiEyeOutline,
  mdiLockOutline,
  mdiPlus,
  mdiSortVariant
} from '@mdi/js'
import RankingList from './RankingList.vue'
import RankingCandidatesSection from './RankingCandidatesSection.vue'
import RankingModesSection from './RankingModesSection.vue'
import RankingGroupCard from './RankingGroupCard.vue'
import RankingPreview from './RankingPreview.vue'
import RankingLegacySummary from './RankingLegacySummary.vue'
import RankingHpoHint from './RankingHpoHint.vue'
import {
  RankingEditorKey,
  RULESET_PATH,
  useShortlistRankingEditor
} from '../../composables/useShortlistRankingEditor'
import { useAppState } from '../../composables/useAppState'
import { usePermissions } from '../../composables/usePermissions'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import { downloadBlob } from '../../utils/download'
import { formatError } from '../../utils/ipc-result'
import { logService } from '../../services/LogService'
import { problemKey, type EvidenceProblem } from '../../../../shared/evidence/ruleset-problems'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ presetId: number | null }>()

const editor = useShortlistRankingEditor()
provide(RankingEditorKey, editor)
const { draft, selected, readOnly, dirty, problems } = editor
const { canWrite } = usePermissions()
const { showSnack } = useAppState()

const saving = ref(false)
const openGroups = ref<number[]>([])
const editorPane = ref<HTMLElement | null>(null)
// The preview sits beside the editor so the effect of an edit stays in view.
const showPreview = ref(false)
// Confirmed in the footer: a snackbar would cover the dialog's own buttons.
const savedName = ref<string | null>(null)

watch(
  open,
  (isOpen) => {
    if (isOpen) void editor.open(props.presetId)
  },
  { immediate: true }
)

/** Run `action` unless it would drop unsaved edits the user wants to keep. */
function guarded(action: () => void): void {
  if (dirty.value && !readOnly.value && !window.confirm(COPY.confirm.discard)) return
  action()
  savedName.value = null
  openGroups.value = []
  editorPane.value?.scrollTo({ top: 0 })
}

function close(): void {
  guarded(() => (open.value = false))
}

function onImport(text: string): void {
  guarded(() => {
    const error = editor.importText(text)
    if (error !== null) showSnack(error, 'error')
  })
}

function onExport(): void {
  const file = editor.exportFile()
  if (file) downloadBlob(new Blob([file.text], { type: 'application/json' }), file.fileName)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const saved = await editor.save()
    savedName.value = saved?.name ?? null
  } catch (e) {
    logService.error(`saving shortlist ranking failed: ${formatError(e)}`, 'shortlist.ranking')
    showSnack(formatError(e), 'error')
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  const name = selected.value?.name ?? ''
  if (!window.confirm(COPY.confirm.remove(name))) return
  try {
    await editor.remove()
  } catch (e) {
    showSnack(formatError(e), 'error')
  }
}

function addGroup(): void {
  editor.addGroup()
  const last = editor.ruleset.value!.groups.length - 1
  openGroups.value = [...openGroups.value, last]
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    if (!readOnly.value && dirty.value && problems.value.length === 0) void save()
  }
}

/** Reveal the field of a problem: open its group, scroll to the closest marked element, focus it. */
async function jumpTo(problem: EvidenceProblem): Promise<void> {
  const [a, b, kind, index] = problem.path
  if (
    a === RULESET_PATH[0] &&
    b === RULESET_PATH[1] &&
    kind === 'groups' &&
    typeof index === 'number'
  ) {
    if (!openGroups.value.includes(index)) openGroups.value = [...openGroups.value, index]
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  for (let n = problem.path.length; n > 0; n -= 1) {
    const key = problemKey(problem.path.slice(0, n))
    const el = editorPane.value?.querySelector<HTMLElement>(`[data-problem-key="${key}"]`)
    if (!el) continue
    el.scrollIntoView({ block: 'center' })
    el.querySelector<HTMLElement>('input, textarea, button')?.focus()
    return
  }
}
</script>

<template>
  <v-dialog
    v-model="open"
    :max-width="showPreview && draft ? 1480 : 1180"
    scrollable
    :persistent="dirty || saving"
  >
    <v-card class="ranking-dialog" data-testid="shortlist-ranking-dialog" @keydown="onKeydown">
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiSortVariant" class="mr-2" />
        {{ COPY.title }}
        <v-spacer />
        <v-btn :aria-label="COPY.actions.cancel" icon variant="text" size="small" @click="close">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-divider />
      <div class="ranking-dialog__body">
        <RankingList
          class="ranking-dialog__list"
          :can-write="canWrite"
          @select="(id) => guarded(() => editor.select(id))"
          @new="guarded(editor.newFromTemplate)"
          @import="onImport"
          @export="onExport"
        />
        <v-divider vertical />
        <div ref="editorPane" class="ranking-dialog__editor" data-testid="ranking-editor">
          <template v-if="draft">
            <div class="editor-head">
              <template v-if="readOnly">
                <div class="editor-head__name">
                  <span class="text-subtitle-1 font-weight-medium">{{ draft.name }}</span>
                  <v-icon
                    v-if="selected?.isBuiltIn"
                    :icon="mdiLockOutline"
                    size="16"
                    class="ml-1"
                    aria-hidden="true"
                  />
                  <span v-if="selected?.isBuiltIn" class="visually-hidden">
                    {{ COPY.labels.builtIn }}
                  </span>
                  <div v-if="draft.description" class="text-caption text-medium-emphasis">
                    {{ draft.description }}
                  </div>
                </div>
              </template>
              <template v-else>
                <v-text-field
                  v-model="draft.name"
                  :label="COPY.fields.name"
                  :error-messages="editor.messagesAt('name')"
                  data-problem-key="name"
                  hide-details="auto"
                  class="editor-head__field"
                />
                <v-text-field
                  v-model="draft.description"
                  :label="COPY.fields.description"
                  hide-details
                  class="editor-head__field editor-head__field--wide"
                />
              </template>
              <v-spacer />
              <v-btn
                v-if="canWrite"
                size="small"
                :variant="selected?.isBuiltIn ? 'tonal' : 'text'"
                :color="selected?.isBuiltIn ? 'primary' : undefined"
                :prepend-icon="mdiContentCopy"
                data-testid="ranking-duplicate"
                @click="guarded(editor.duplicate)"
              >
                {{ readOnly ? COPY.actions.duplicate : COPY.actions.copy }}
              </v-btn>
              <v-btn
                v-if="!readOnly && selected"
                size="small"
                variant="text"
                color="error"
                :prepend-icon="mdiDeleteOutline"
                @click="remove"
              >
                {{ COPY.actions.deleteRanking }}
              </v-btn>
            </div>
            <RankingCandidatesSection />
            <RankingModesSection />
            <section class="ranking-section" aria-labelledby="ranking-groups-heading">
              <h3 id="ranking-groups-heading" class="ranking-section__title">
                {{ COPY.sections.groups }}
              </h3>
              <p class="ranking-section__help">{{ COPY.sections.groupsHelp }}</p>
              <RankingHpoHint :ruleset="draft.config.rankConfig.ruleset" />
              <v-expansion-panels v-model="openGroups" multiple variant="accordion" class="groups">
                <RankingGroupCard
                  v-for="(group, gi) in draft.config.rankConfig.ruleset.groups"
                  :key="group.id"
                  :group-index="gi"
                />
              </v-expansion-panels>
              <v-btn
                v-if="!readOnly"
                variant="text"
                size="small"
                :prepend-icon="mdiPlus"
                class="mt-2"
                data-testid="group-add"
                @click="addGroup"
              >
                {{ COPY.actions.addGroup }}
              </v-btn>
            </section>
          </template>
          <div v-else-if="selected" class="legacy" data-testid="ranking-legacy">
            <div class="d-flex align-center">
              <span class="text-subtitle-1 font-weight-medium">{{ selected.name }}</span>
              <v-icon
                v-if="selected.isBuiltIn"
                :icon="mdiLockOutline"
                size="16"
                class="ml-1"
                aria-hidden="true"
              />
              <span v-if="selected.isBuiltIn" class="visually-hidden">
                {{ COPY.labels.builtIn }}
              </span>
              <v-spacer />
              <v-btn
                v-if="canWrite"
                size="small"
                variant="tonal"
                color="primary"
                :prepend-icon="mdiContentCopy"
                data-testid="ranking-duplicate"
                @click="guarded(editor.duplicate)"
              >
                {{ COPY.actions.duplicate }}
              </v-btn>
            </div>
            <p v-if="selected.description" class="legacy__description">
              {{ selected.description }}
            </p>
            <RankingLegacySummary :preset="selected" />
            <p class="ranking-section__help">{{ COPY.sections.legacyHelp }}</p>
          </div>
        </div>
        <template v-if="showPreview && draft">
          <v-divider vertical />
          <aside class="ranking-dialog__preview">
            <RankingPreview />
          </aside>
        </template>
      </div>
      <div class="visually-hidden" aria-live="polite" data-testid="ranking-announcement">
        {{ editor.announcement.value }}
      </div>
      <v-divider />
      <v-card-actions class="ranking-dialog__actions">
        <v-menu v-if="problems.length > 0" location="top start">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              color="error"
              variant="text"
              size="small"
              :prepend-icon="mdiAlertCircleOutline"
              data-testid="ranking-problems"
            >
              {{ COPY.errors.count(problems.length) }}
            </v-btn>
          </template>
          <v-list density="compact" max-height="320" max-width="560">
            <v-list-item
              v-for="(problem, i) in problems"
              :key="i"
              :title="editor.problemLabel(problem)"
              :subtitle="problem.message"
              @click="jumpTo(problem)"
            />
          </v-list>
        </v-menu>
        <span
          v-if="savedName && !dirty"
          class="ranking-dialog__saved text-caption"
          role="status"
          data-testid="ranking-saved"
        >
          {{ COPY.saved(savedName) }}
        </span>
        <v-spacer />
        <v-btn
          v-if="draft"
          variant="text"
          size="small"
          :prepend-icon="mdiEyeOutline"
          :active="showPreview"
          :aria-pressed="showPreview"
          data-testid="ranking-preview-toggle"
          @click="showPreview = !showPreview"
        >
          {{ COPY.actions.togglePreview }}
        </v-btn>
        <v-btn variant="text" @click="close">{{ COPY.actions.cancel }}</v-btn>
        <v-btn
          v-if="!readOnly && draft"
          color="primary"
          variant="flat"
          :disabled="!dirty || problems.length > 0"
          :loading="saving"
          data-testid="ranking-save"
          @click="save"
        >
          {{ COPY.actions.save }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped src="./ranking-shared.css"></style>

<style scoped>
.ranking-dialog__body {
  display: flex;
  min-height: 0;
  height: min(78vh, 820px);
}
.ranking-dialog__list {
  flex: 0 0 236px;
}
.ranking-dialog__editor {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  padding: 8px 16px 16px;
}
.editor-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 0 10px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.editor-head__field {
  flex: 0 1 240px;
}
.editor-head__field--wide {
  flex: 1 1 260px;
}
.groups :deep(.v-expansion-panel-text__wrapper) {
  padding: 6px 12px 10px;
}
.legacy {
  padding: 10px 0;
  max-width: 640px;
}
.legacy__description {
  margin: 4px 0 0;
  font-size: 0.8125rem;
}
.ranking-dialog__preview {
  flex: 0 0 320px;
  min-width: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
}
/* Dense fields: the editor shows many rows; text stays legible at 13px. */
.ranking-dialog__editor :deep(.v-input--density-compact) {
  --v-input-control-height: 32px;
  --v-input-padding-top: 4px;
}
.ranking-dialog__editor :deep(.v-input--density-compact .v-field) {
  --v-field-padding-bottom: 4px;
}
.ranking-dialog__editor :deep(.v-field__input) {
  font-size: 0.8125rem;
}
.ranking-dialog__saved {
  color: rgb(var(--v-theme-success));
}
.ranking-dialog__actions {
  padding-inline: 16px;
}
@media (max-width: 760px) {
  .ranking-dialog__body {
    flex-direction: column;
    height: auto;
  }
  .ranking-dialog__list {
    flex-basis: auto;
  }
}
</style>
