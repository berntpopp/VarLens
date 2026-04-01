<template>
  <div class="external-links-section">
    <div class="text-title-small mb-2">External Links</div>
    <div class="d-flex flex-wrap ga-1">
      <div
        v-for="link in visibleLinks"
        :key="link.id"
        class="d-flex flex-column align-center external-link-item"
      >
        <v-tooltip location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              icon
              size="small"
              variant="tonal"
              @click="openLink(link.id)"
            >
              <v-icon>{{ getLinkIcon(link.id) }}</v-icon>
            </v-btn>
          </template>
          {{ link.name }}
        </v-tooltip>
        <span class="text-body-small text-center text-truncate external-link-label">
          {{ getLinkLabel(link.id) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useExternalLinksStore } from '../stores/externalLinksStore'
import { useApiService } from '../composables/useApiService'
import { resolveUrlTemplate } from '../utils/externalLinks'
import { logService } from '../services/LogService'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import {
  mdiBookOpenVariant,
  mdiChartBox,
  mdiDatabase,
  mdiDatabaseSearch,
  mdiDna,
  mdiHospitalBox,
  mdiKeyVariant,
  mdiMap,
  mdiOpenInNew,
  mdiTelescope,
  mdiTextSearch
} from '@mdi/js'

interface Props {
  variant: Variant | CohortVariant
}

const props = defineProps<Props>()

const { api } = useApiService()
const externalLinksStore = useExternalLinksStore()

/**
 * Map link IDs to Material Design Icons
 */
function getLinkIcon(linkId: string): string {
  const iconMap: Record<string, string> = {
    gnomad: mdiDna,
    ucsc: mdiMap,
    clinvar: mdiHospitalBox,
    varsome: mdiChartBox,
    franklin: mdiTelescope,
    pubtator: mdiBookOpenVariant,
    litvar: mdiTextSearch,
    decipher: mdiKeyVariant,
    clingen: mdiDatabaseSearch,
    ensembl: mdiDatabase
  }

  return iconMap[linkId] ?? mdiOpenInNew
}

/**
 * Map link IDs to short display labels
 */
function getLinkLabel(linkId: string): string {
  const labelMap: Record<string, string> = {
    gnomad: 'gnomAD',
    ucsc: 'UCSC',
    clinvar: 'ClinVar',
    varsome: 'VarSome',
    franklin: 'Franklin',
    pubtator: 'PubTator',
    litvar: 'LitVar',
    decipher: 'DECIPHER',
    clingen: 'ClinGen',
    ensembl: 'Ensembl'
  }

  return labelMap[linkId] ?? linkId
}

/**
 * Get only links that can be resolved with current variant data
 */
const visibleLinks = computed(() => {
  return externalLinksStore.enabledLinks
    .map((link) => {
      // Convert variant to VariantLinkData interface
      const variantData = {
        chr: props.variant.chr,
        pos: props.variant.pos,
        ref: props.variant.ref,
        alt: props.variant.alt,
        gene_symbol: props.variant.gene_symbol,
        mim_number: null // Not in current schema
      }

      const resolvedUrl = resolveUrlTemplate(
        link.urlTemplate,
        variantData,
        externalLinksStore.genomeBuild,
        link.requiredFields
      )

      return {
        id: link.id,
        name: link.name,
        resolvedUrl
      }
    })
    .filter((link) => link.resolvedUrl !== null)
})

/**
 * Open external link in system browser
 */
async function openLink(linkId: string): Promise<void> {
  const link = visibleLinks.value.find((l) => l.id === linkId)
  if (link === undefined || link.resolvedUrl === null) return

  try {
    await api!.shell.openExternal(link.resolvedUrl)
  } catch (e) {
    logService.warn(
      'Failed to open external link: ' + (e instanceof Error ? e.message : String(e)),
      'links'
    )
  }
}
</script>

<style scoped>
.external-link-item {
  width: 72px;
}

.external-link-label {
  max-width: 72px;
  font-size: 11px;
  line-height: 1.2;
  margin-top: 2px;
}
</style>
