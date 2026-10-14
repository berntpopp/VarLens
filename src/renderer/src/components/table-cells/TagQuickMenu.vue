<template>
  <!-- Single shared tag menu (see tag-quick-menu.ts). The row buttons own the
       click handling, so the menu never binds its own. -->
  <v-menu
    v-model="open"
    :activator="activator ?? undefined"
    :open-on-click="false"
    :close-on-content-click="false"
    location="bottom"
  >
    <v-card v-if="request" min-width="200" max-width="280">
      <v-list v-if="request.toggle" density="compact" class="py-1" aria-label="Tags">
        <v-list-item
          v-for="tag in tags"
          :key="tag.id"
          role="menuitemcheckbox"
          :aria-checked="isAssigned(tag.id)"
          class="px-2"
          @click="request.toggle(tag)"
        >
          <template #prepend>
            <v-icon
              size="small"
              class="mr-2"
              :icon="isAssigned(tag.id) ? mdiCheckboxMarked : mdiCheckboxBlankOutline"
            />
          </template>
          <v-list-item-title class="text-body-small">{{ tag.name }}</v-list-item-title>
          <template #append>
            <span class="tag-dot tag-dot--menu ml-2" :style="{ backgroundColor: tag.color }" />
          </template>
        </v-list-item>
        <div v-if="tags.length === 0" class="text-body-small text-muted pa-2">
          No tags yet. Create tags in Settings.
        </div>
      </v-list>
      <div v-else class="pa-2">
        <div v-if="request.readOnlyHint" class="text-body-small text-medium-emphasis mb-1">
          {{ request.readOnlyHint }}
        </div>
        <div v-if="request.assigned().length === 0" class="text-body-small text-muted">No tags</div>
        <div v-for="tag in request.assigned()" :key="tag.id" class="d-flex align-center ga-2 py-1">
          <span class="tag-dot tag-dot--menu" :style="{ backgroundColor: tag.color }" />
          <span class="text-body-small">{{ tag.name }}</span>
        </div>
      </div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { mdiCheckboxBlankOutline, mdiCheckboxMarked } from '@mdi/js'
import type { TagQuickMenuState } from './tag-quick-menu'

const props = defineProps<{ state: TagQuickMenuState }>()

// The state object is created once by the table and never replaced.
const { open, activator, payload: request, tags } = props.state

const isAssigned = (tagId: number): boolean =>
  request.value?.assigned().some((t) => t.id === tagId) === true
</script>
