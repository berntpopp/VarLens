<template>
  <div>
    <v-toolbar density="compact" color="primary" dark>
      <span class="ml-2 text-subtitle-1 font-weight-medium">Cases</span>
      <v-spacer />
      <v-tooltip location="bottom" text="Import variant file">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="tooltipProps"
            icon
            size="small"
            variant="text"
            @click="$emit('import-click')"
          >
            <v-icon>mdi-plus</v-icon>
          </v-btn>
        </template>
      </v-tooltip>
    </v-toolbar>

    <slot />
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  'import-click': []
}>()
</script>
