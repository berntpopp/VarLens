<template>
  <div>
    <v-toolbar density="compact" color="primary" dark>
      <span class="ml-2 text-subtitle-1 font-weight-medium">Cases</span>
      <v-spacer />
      <v-btn icon size="small" variant="text" @click="$emit('import-click')">
        <v-icon>mdi-plus</v-icon>
        <v-tooltip activator="parent" location="bottom">Import variant file</v-tooltip>
      </v-btn>
    </v-toolbar>

    <slot />
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  'import-click': []
}>()
</script>
