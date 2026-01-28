<template>
  <v-dialog v-model="isOpen" max-width="700" scrollable>
    <v-card>
      <v-card-title>External Links Settings</v-card-title>
      <v-card-text>
        <!-- Genome Build Selector -->
        <div class="mb-4">
          <div class="text-subtitle-2 mb-2">Genome Build</div>
          <v-btn-toggle
            v-model="buildSelection"
            color="primary"
            mandatory
            variant="outlined"
            density="compact"
          >
            <v-btn value="GRCh37">GRCh37</v-btn>
            <v-btn value="GRCh38">GRCh38</v-btn>
          </v-btn-toggle>
          <div class="text-caption text-medium-emphasis mt-1">
            Affects build-dependent URLs (gnomAD dataset, UCSC db)
          </div>
        </div>

        <v-divider class="my-4" />

        <!-- Link List -->
        <div class="mb-4">
          <div class="text-subtitle-2 mb-2">Configured Links</div>

          <v-list density="compact">
            <v-list-item
              v-for="link in linksStore.links"
              :key="link.id"
              :class="{ 'text-medium-emphasis': !link.enabled }"
            >
              <template #prepend>
                <v-switch
                  :model-value="link.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  @update:model-value="linksStore.toggleLink(link.id)"
                />
              </template>

              <v-list-item-title class="d-flex align-center ga-2">
                <span :class="{ 'font-weight-bold': link.isBuiltIn }">{{ link.name }}</span>
                <v-chip v-if="link.isBuiltIn" size="x-small" variant="outlined">Default</v-chip>
                <v-chip size="x-small" variant="tonal">{{ getColumnLabel(link.column) }}</v-chip>
              </v-list-item-title>

              <template #append>
                <v-btn
                  icon="mdi-pencil"
                  size="x-small"
                  variant="text"
                  @click="startEditLink(link)"
                />
                <v-btn
                  v-if="!link.isBuiltIn"
                  icon="mdi-delete"
                  size="x-small"
                  variant="text"
                  @click="confirmDeleteLink(link.id)"
                />
              </template>
            </v-list-item>
          </v-list>

          <v-btn
            color="primary"
            variant="outlined"
            prepend-icon="mdi-plus"
            class="mt-2"
            @click="startAddLink"
          >
            Add Custom Link
          </v-btn>
        </div>

        <!-- Edit/Add Form -->
        <v-expand-transition>
          <v-card v-if="editingLink !== null" variant="outlined" class="mt-4">
            <v-card-text>
              <div class="text-subtitle-2 mb-3">
                {{ isAddMode ? 'Add Custom Link' : `Edit ${editingLink.name}` }}
              </div>

              <v-text-field
                v-model="editForm.name"
                label="Name"
                variant="outlined"
                density="compact"
                :error-messages="nameError"
                class="mb-3"
              />

              <v-text-field
                v-model="editForm.urlTemplate"
                label="URL Template"
                variant="outlined"
                density="compact"
                :error-messages="urlError"
                class="mb-3"
                style="font-family: monospace"
              />

              <v-select
                v-model="editForm.column"
                label="Column"
                :items="columnOptions"
                variant="outlined"
                density="compact"
                class="mb-3"
              />

              <v-select
                v-model="editForm.requiredFields"
                label="Required Fields"
                :items="requiredFieldOptions"
                variant="outlined"
                density="compact"
                multiple
                chips
                :error-messages="fieldsError"
                class="mb-3"
              />

              <!-- Variable Reference -->
              <v-expansion-panels variant="accordion" class="mb-3">
                <v-expansion-panel>
                  <v-expansion-panel-title>Available Variables</v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <div class="text-caption">
                      <div><code>{chr}</code> - Chromosome (e.g., "1", "X")</div>
                      <div><code>{pos}</code> - Position (e.g., 12345)</div>
                      <div><code>{ref}</code> - Reference allele (e.g., "A")</div>
                      <div><code>{alt}</code> - Alternate allele (e.g., "G")</div>
                      <div><code>{gene}</code> - Gene symbol (e.g., "BRCA1")</div>
                      <div><code>{build}</code> - Genome build (GRCh37 or GRCh38)</div>
                      <div><code>{build_ucsc}</code> - UCSC build (hg19 or hg38)</div>
                      <div>
                        <code>{dataset_gnomad}</code> - gnomAD dataset (gnomad_r2_1 or gnomad_r4)
                      </div>
                      <div><code>{pos_start}</code> - Position - 25 (min 1)</div>
                      <div><code>{pos_end}</code> - Position + 25</div>
                    </div>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>

              <div class="d-flex ga-2">
                <v-btn color="primary" variant="flat" @click="saveEdit">Save</v-btn>
                <v-btn variant="outlined" @click="cancelEdit">Cancel</v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-expand-transition>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn color="error" variant="outlined" prepend-icon="mdi-restore" @click="confirmReset">
          Reset to Defaults
        </v-btn>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="isOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Link?</v-card-title>
        <v-card-text>
          Are you sure you want to delete this custom link? This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="executeDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Reset Confirmation Dialog -->
    <v-dialog v-model="resetDialog" max-width="400">
      <v-card>
        <v-card-title>Reset to Defaults?</v-card-title>
        <v-card-text>
          This will restore all built-in links to their original settings and remove all custom
          links. This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="executeReset">Reset</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  useExternalLinksStore,
  type ExternalLinkConfig,
  type LinkColumn
} from '../stores/externalLinksStore'

const linksStore = useExternalLinksStore()

const isOpen = ref(false)

// Build selection (synced with store)
const buildSelection = ref<'GRCh37' | 'GRCh38'>(linksStore.genomeBuild)
watch(buildSelection, (newBuild) => {
  linksStore.setGenomeBuild(newBuild)
})

// Edit state
const editingLink = ref<ExternalLinkConfig | null>(null)
const isAddMode = ref(false)
const editForm = ref({
  name: '',
  urlTemplate: '',
  column: 'virtual' as LinkColumn,
  requiredFields: [] as string[]
})

// Delete confirmation
const deleteDialog = ref(false)
const linkToDelete = ref<string | null>(null)

// Reset confirmation
const resetDialog = ref(false)

// Column options for select
const columnOptions = [
  { title: 'Position', value: 'pos' },
  { title: 'Chromosome', value: 'chr' },
  { title: 'ClinVar', value: 'clinvar' },
  { title: 'Gene Symbol', value: 'gene_symbol' },
  { title: 'Virtual Column', value: 'virtual' }
]

// Required field options
const requiredFieldOptions = [
  { title: 'chr', value: 'chr' },
  { title: 'pos', value: 'pos' },
  { title: 'ref', value: 'ref' },
  { title: 'alt', value: 'alt' },
  { title: 'gene', value: 'gene' }
]

// Validation
const nameError = computed(() => {
  if (editingLink.value !== null && editForm.value.name === '') {
    return 'Name is required'
  }
  return ''
})

const urlError = computed(() => {
  if (editingLink.value !== null) {
    if (editForm.value.urlTemplate === '') {
      return 'URL template is required'
    }
    if (!editForm.value.urlTemplate.startsWith('https://')) {
      return 'URL must start with https://'
    }
  }
  return ''
})

const fieldsError = computed(() => {
  if (editingLink.value !== null && editForm.value.requiredFields.length === 0) {
    return 'At least one required field must be selected'
  }
  return ''
})

const isFormValid = computed(() => {
  return nameError.value === '' && urlError.value === '' && fieldsError.value === ''
})

// Helper functions
const getColumnLabel = (column: LinkColumn): string => {
  const labels: Record<LinkColumn, string> = {
    pos: 'Position',
    chr: 'Chr',
    clinvar: 'ClinVar',
    gene_symbol: 'Gene',
    omim_mim_number: 'OMIM',
    virtual: 'Column'
  }
  return labels[column]
}

const startEditLink = (link: ExternalLinkConfig): void => {
  editingLink.value = link
  isAddMode.value = false
  editForm.value = {
    name: link.name,
    urlTemplate: link.urlTemplate,
    column: link.column,
    requiredFields: [...link.requiredFields]
  }
}

const startAddLink = (): void => {
  editingLink.value = {} as ExternalLinkConfig
  isAddMode.value = true
  editForm.value = {
    name: '',
    urlTemplate: '',
    column: 'virtual',
    requiredFields: []
  }
}

const cancelEdit = (): void => {
  editingLink.value = null
  isAddMode.value = false
}

const saveEdit = (): void => {
  if (!isFormValid.value || editingLink.value === null) return

  if (isAddMode.value) {
    linksStore.addCustomLink({
      name: editForm.value.name,
      urlTemplate: editForm.value.urlTemplate,
      column: editForm.value.column,
      requiredFields: editForm.value.requiredFields,
      enabled: true
    })
  } else {
    linksStore.updateLink(editingLink.value.id, {
      name: editForm.value.name,
      urlTemplate: editForm.value.urlTemplate,
      column: editForm.value.column,
      requiredFields: editForm.value.requiredFields
    })
  }

  cancelEdit()
}

const confirmDeleteLink = (id: string): void => {
  linkToDelete.value = id
  deleteDialog.value = true
}

const executeDelete = (): void => {
  if (linkToDelete.value !== null) {
    linksStore.removeLink(linkToDelete.value)
  }
  deleteDialog.value = false
  linkToDelete.value = null
}

const confirmReset = (): void => {
  resetDialog.value = true
}

const executeReset = (): void => {
  linksStore.resetToDefaults()
  resetDialog.value = false
  cancelEdit()
}

const show = (): void => {
  isOpen.value = true
  buildSelection.value = linksStore.genomeBuild
  cancelEdit()
}

defineExpose({ show })
</script>
