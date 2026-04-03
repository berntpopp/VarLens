<template>
  <div v-if="visible" class="perf-overlay">
    <div class="perf-header">
      <span class="text-caption font-weight-bold">Perf Traces</span>
      <v-btn icon size="x-small" variant="text" @click="visible = false">
        <v-icon size="14">{{ mdiClose }}</v-icon>
      </v-btn>
    </div>
    <div class="perf-entries">
      <div
        v-for="(entry, i) in traces"
        :key="i"
        class="perf-entry"
        :class="{ 'over-budget': entry.overBudget }"
      >
        <span class="perf-name text-caption">{{ entry.name }}</span>
        <span class="perf-duration text-caption font-weight-medium">
          {{ entry.duration.toFixed(1) }}ms
        </span>
      </div>
      <div v-if="traces.length === 0" class="text-caption text-medium-emphasis pa-1">
        No traces yet
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { getRecentTraces, type PerfEntry } from '../../services/PerfTrace'
import { mdiClose } from '@mdi/js'

const visible = ref(true)
const traces = ref<readonly PerfEntry[]>([])

let interval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  interval = setInterval(() => {
    traces.value = getRecentTraces(15)
  }, 1000)
})

onUnmounted(() => {
  if (interval !== null) clearInterval(interval)
})
</script>

<style scoped>
.perf-overlay {
  position: fixed;
  bottom: 8px;
  right: 8px;
  width: 280px;
  max-height: 300px;
  background: rgba(0, 0, 0, 0.85);
  color: #eee;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  z-index: 9999;
  overflow: hidden;
}
.perf-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.perf-entries {
  max-height: 260px;
  overflow-y: auto;
}
.perf-entry {
  display: flex;
  justify-content: space-between;
  padding: 2px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.perf-entry.over-budget {
  background: rgba(255, 80, 80, 0.2);
  color: #ff8888;
}
.perf-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}
.perf-duration {
  flex-shrink: 0;
}
</style>
