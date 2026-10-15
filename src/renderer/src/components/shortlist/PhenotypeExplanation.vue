<script setup lang="ts">
/** The phenotype explanation lines (rank tooltip and phenotype column tooltip). */
import { computed } from 'vue'
import type { HpoExplanation } from '../../../../shared/types/hpo-profile'
import { phenotypeLines } from './rank-tooltip-phenotype'

const props = defineProps<{ hpo: HpoExplanation }>()
const lines = computed(() => phenotypeLines(props.hpo))
</script>

<template>
  <div class="font-weight-bold">{{ lines.title }}</div>
  <div v-if="lines.matched !== null">{{ lines.matched }}</div>
  <div v-if="lines.conflicts !== null">{{ lines.conflicts }}</div>
  <div v-if="lines.locus !== null">{{ lines.locus }}</div>
  <div>{{ lines.rank }}</div>
</template>
