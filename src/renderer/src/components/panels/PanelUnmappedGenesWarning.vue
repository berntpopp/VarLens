<template>
  <!--
    Lives in the reserved-height applied-filters row of SlimFilterToolbar, so
    appearing (the status arrives after the table) never moves the table. The
    full sentence and gene list open in an overlay on hover, focus or click.
  -->
  <div v-if="warning" class="panel-unmapped-warning" data-testid="panel-unmapped-genes-warning">
    <v-menu
      open-on-hover
      open-on-focus
      location="bottom start"
      :close-on-content-click="false"
      max-width="480"
    >
      <template #activator="{ props: menuProps }">
        <v-chip
          v-bind="menuProps"
          color="warning"
          variant="flat"
          size="small"
          link
          role="button"
          class="panel-unmapped-warning__chip"
          :aria-label="`Warning: ${warning.text}. Show details`"
        >
          <v-icon start size="small" :icon="mdiAlert" />
          <span class="panel-unmapped-warning__text">{{ warning.text }}</span>
        </v-chip>
      </template>
      <v-card>
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
          :icon="mdiAlert"
          class="panel-unmapped-warning__details"
          data-testid="panel-unmapped-genes-details"
        >
          <div class="text-body-2 font-weight-medium">{{ warning.summary }}.</div>
          <template v-if="warning.kind === 'unmapped'">
            <div class="panel-unmapped-warning__genes text-body-2 mt-2">
              {{ warning.allSymbols.join(', ') }}
            </div>
            <div class="text-caption mt-2">
              Variants in these genes are missing from the panel-filtered table. Exports and the
              shortlist apply the same panel regions.
            </div>
          </template>
          <div v-else class="text-caption mt-2">
            Some panel genes may not be applied to this table. Reload the view to check again.
          </div>
        </v-alert>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { mdiAlert } from '@mdi/js'
import { usePanelUnmappedGenesWarning } from '../../composables/usePanelResolutionStatus'

const warning = usePanelUnmappedGenesWarning()
</script>

<style scoped>
/* Takes the free width of the applied-filters row instead of a fixed size:
   it only wraps to a second line when less than `min-width` is left. */
.panel-unmapped-warning {
  flex: 1 1 0;
  min-width: 11rem;
  display: flex;
}

.panel-unmapped-warning .panel-unmapped-warning__chip {
  max-width: 100%;
}

/* Let the chip content shrink so the sentence ends in an ellipsis. */
.panel-unmapped-warning__chip :deep(.v-chip__content) {
  min-width: 0;
}

.panel-unmapped-warning__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-unmapped-warning__genes {
  max-height: 12rem;
  overflow-y: auto;
  overflow-wrap: anywhere;
}
</style>
