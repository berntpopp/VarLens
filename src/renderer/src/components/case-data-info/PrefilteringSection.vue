<template>
  <div class="text-subtitle-2 text-medium-emphasis mb-2">
    <v-icon size="small" class="mr-1">mdi-filter-outline</v-icon>
    Pre-filtering Applied
  </div>
  <v-row dense class="mb-4">
    <v-col cols="6">
      <v-text-field
        :model-value="afFilter"
        label="Allele frequency filter"
        placeholder="e.g. gnomAD AF < 0.01"
        variant="outlined"
        density="compact"
        hide-details
        @update:model-value="$emit('update:afFilter', $event)"
        @blur="$emit('save')"
      />
    </v-col>
    <v-col cols="6">
      <v-text-field
        :model-value="qualityFilter"
        label="Quality filter"
        placeholder="e.g. PASS only, QUAL > 30"
        variant="outlined"
        density="compact"
        hide-details
        @update:model-value="$emit('update:qualityFilter', $event)"
        @blur="$emit('save')"
      />
    </v-col>

    <!-- Gene List (interactive) -->
    <v-col cols="6">
      <div class="d-flex align-center ga-1">
        <v-select
          :model-value="selectedGeneListId"
          label="Gene list / panel"
          :items="geneListItems"
          item-title="text"
          item-value="value"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="flex-grow-1"
          @update:model-value="onGeneListChange($event)"
        />
        <v-btn
          icon="mdi-playlist-edit"
          size="x-small"
          variant="text"
          color="primary"
          @click="$emit('openGeneListEditor')"
        />
      </div>
    </v-col>

    <!-- Region File (interactive) -->
    <v-col cols="6">
      <div class="d-flex align-center ga-1">
        <v-select
          :model-value="selectedRegionFileId"
          label="Region filter (BED)"
          :items="regionFileItems"
          item-title="text"
          item-value="value"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="flex-grow-1"
          @update:model-value="onRegionFileChange($event)"
        />
        <v-btn
          icon="mdi-file-upload-outline"
          size="x-small"
          variant="text"
          color="primary"
          @click="$emit('openRegionFileImport')"
        />
      </div>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
interface SelectItem {
  text: string
  value: number
}

defineProps<{
  afFilter: string
  qualityFilter: string
  selectedGeneListId: number | null
  selectedRegionFileId: number | null
  geneListItems: SelectItem[]
  regionFileItems: SelectItem[]
}>()

const emit = defineEmits<{
  'update:afFilter': [value: string]
  'update:qualityFilter': [value: string]
  'update:selectedGeneListId': [value: number | null]
  'update:selectedRegionFileId': [value: number | null]
  save: []
  openGeneListEditor: []
  openRegionFileImport: []
}>()

function onGeneListChange(value: number | null): void {
  emit('update:selectedGeneListId', value)
  emit('save')
}

function onRegionFileChange(value: number | null): void {
  emit('update:selectedRegionFileId', value)
  emit('save')
}
</script>
