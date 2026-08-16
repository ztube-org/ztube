<script setup lang="ts">
import { useApi } from '../../../src/api'

const { data } = useApi<any>('/api/admin/parents')

function formatDate(date: Date | string | null): string {
  return date ? new Date(date).toLocaleDateString() : '-'
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-8">Admin Panel</h1>
    <UCard>
      <template #header><h2 class="font-semibold">Parent Accounts</h2></template>
      <UTable
        :columns="[
          { key: 'email', label: 'Google account' },
          { key: 'displayName', label: 'Name' },
          { key: 'childrenCount', label: 'Children' },
          { key: 'createdAt', label: 'Created' },
        ]"
        :rows="data?.parents || []"
      >
        <template #createdAt-data="{ row }">{{ formatDate(row.createdAt) }}</template>
      </UTable>
      <div v-if="!data?.parents?.length" class="text-center py-8 text-gray-500">
        No parent accounts yet
      </div>
    </UCard>
  </div>
</template>
