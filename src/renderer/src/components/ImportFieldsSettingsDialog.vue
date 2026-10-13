<script setup lang="ts">
/**
 * Settings → Import fields: the default field profile every import starts
 * from (spec §16). Edits a draft; Save writes it to the settings store.
 */
import { computed, ref, watch } from 'vue'
import { mdiClose, mdiTableCog } from '@mdi/js'
import {
  DEFAULT_IMPORT_FIELD_PROFILE,
  type ImportFieldProfile
} from '../../../shared/config/import-fields.config'
import { useSettingsStore } from '../stores/settingsStore'
import { usePermissions } from '../composables/usePermissions'
import { catalogueFields } from '../utils/import-field-rows'
import ImportFieldProfileTable from './import/ImportFieldProfileTable.vue'

const open = defineModel<boolean>('open', { required: true })
const settings = useSettingsStore()
const { canWrite } = usePermissions()

const draft = ref<ImportFieldProfile>(settings.importFieldProfile)
// The listed fields stay put while the draft changes, so rows do not jump.
const fields = ref(catalogueFields(draft.value))
watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = settings.importFieldProfile
  fields.value = catalogueFields(draft.value)
})
const dirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(settings.importFieldProfile)
)

function save(): void {
  settings.importFieldProfile = draft.value
  open.value = false
}
function reset(): void {
  draft.value = DEFAULT_IMPORT_FIELD_PROFILE
}
</script>

<template>
  <v-dialog v-model="open" max-width="980" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiTableCog" class="mr-2" />
        Import fields
        <v-spacer />
        <v-btn aria-label="Close" icon variant="text" size="small" @click="open = false">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <p class="import-fields__help">
          Fields an import keeps besides the mapped columns, stored as
          <code>info.&lt;key&gt;</code>. Evidence fields share one key across sources (<code
            >RevelScore</code
          >
          and <code>REVEL_score</code> → <code>info.REVEL</code>), so one filter or ranking rule
          fits both. The import wizard starts from these choices.
        </p>
        <ImportFieldProfileTable
          v-model="draft"
          :fields="fields"
          :readonly="!canWrite"
          :height="420"
        />
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-btn variant="text" size="small" :disabled="!canWrite" @click="reset">
          Reset to defaults
        </v-btn>
        <v-spacer />
        <v-btn variant="text" size="small" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          :disabled="!canWrite || !dirty"
          data-testid="import-fields-save"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.import-fields__help {
  margin: 0 0 10px;
  max-width: 80ch;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
