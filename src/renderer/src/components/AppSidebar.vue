<template>
  <div>
    <v-toolbar density="compact" color="primary" dark>
      <span class="ml-2 text-subtitle-1 font-weight-medium">Cases</span>
      <v-spacer />
      <v-menu>
        <template #activator="{ props }">
          <v-btn icon size="small" variant="text" v-bind="props">
            <v-icon>mdi-plus</v-icon>
            <v-tooltip activator="parent" location="bottom">Import variant data</v-tooltip>
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item @click="$emit('import-click')">
            <template #prepend>
              <v-icon>mdi-file-import</v-icon>
            </template>
            <v-list-item-title>Import File</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('batch-import-files')">
            <template #prepend>
              <v-icon>mdi-file-multiple</v-icon>
            </template>
            <v-list-item-title>Import Multiple Files</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('batch-import-folder')">
            <template #prepend>
              <v-icon>mdi-folder-open</v-icon>
            </template>
            <v-list-item-title>Import Folder</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('batch-import-zip')">
            <template #prepend>
              <v-icon>mdi-zip-box</v-icon>
            </template>
            <v-list-item-title>Import ZIP Archive</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-toolbar>

    <slot />
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  'import-click': []
  'batch-import-files': []
  'batch-import-folder': []
  'batch-import-zip': []
}>()
</script>
