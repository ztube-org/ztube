<script setup lang="ts">
import { ref } from 'vue'
import AdminNav from '../../components/AdminNav.vue'
import { apiFetch, useApi } from '../../../src/api'
import type { AdminChild } from '../../../src/domain'

const { data, error, refresh } = useApi<{ children: AdminChild[] }>('/api/admin/children')
const pending = ref(false)
const actionError = ref('')
const notice = ref('')

async function refreshDashboard() {
  if (pending.value) return
  pending.value = true
  try { await refresh() } catch {}
  finally { pending.value = false }
}

async function updateViewing(action: () => Promise<unknown>, message: string) {
  if (pending.value) return
  pending.value = true
  actionError.value = ''
  notice.value = ''
  try {
    await action()
    notice.value = message
    await refresh().catch(() => {})
  } catch (cause) { actionError.value = cause instanceof Error ? cause.message : 'Unable to update viewing' }
  finally { pending.value = false }
}

const childName = (child: AdminChild) => child.displayName || child.email
const isPaused = (child: AdminChild) => child.policy?.reason === 'viewing-pause'

function togglePause(child: AdminChild) {
  const paused = !isPaused(child)
  return updateViewing(
    () => apiFetch(`/api/admin/children/${child.id}/watch-time/viewing-pause`, { method: 'PUT', body: { paused } }),
    `${childName(child)}’s viewing ${paused ? 'paused for today' : 'resumed'}.`,
  )
}

function extendPool(child: AdminChild, pool: AdminChild['pools'][number]) {
  return updateViewing(
    () => apiFetch(`/api/admin/children/${child.id}/time-pools/${encodeURIComponent(pool.id)}/extensions`, { method: 'POST', body: { minutes: 15 } }),
    `Added 15 min to ${childName(child)}’s ${pool.name} Time Pool.`,
  )
}

function viewingStatus(child: AdminChild) {
  switch (child.policy?.reason) {
    case 'viewing-pause': return 'Paused for today'
    case 'required-break': return 'On a Required Break'
    case 'outside-window': return 'Outside Viewing Window'
  }
  if (child.activePlayback?.watching) {
    const { videoTitle } = child.activePlayback
    return videoTitle ? `Watching · ${videoTitle}` : 'Watching'
  }
  return 'Ready to watch'
}
</script>

<template>
  <div class="zt-page">
    <AdminNav />
    <header class="mb-3 flex items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">Children</h1>
      <UButton class="min-h-11" variant="ghost" color="neutral" :disabled="pending" icon="i-heroicons-arrow-path"
        @click="refreshDashboard">Refresh</UButton>
    </header>
    <p v-if="error" role="alert" class="mb-3 rounded-lg border border-red-300 p-2 text-sm text-red-600">{{ error.message }}</p>
    <p v-if="actionError" role="alert" class="mb-3 rounded-lg border border-red-300 p-2 text-sm text-red-600">{{ actionError }}</p>
    <p v-if="notice" role="status" class="mb-3 rounded-lg border border-[var(--zt-border)] p-2 text-sm">{{ notice }}</p>
    <p v-if="!data && !error" role="status" class="text-sm text-[var(--zt-muted)]">Loading children…</p>
    <div class="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <UCard v-for="child in data?.children" :key="child.id" as="article" :aria-labelledby="`child-name-${child.id}`"
        class="overflow-hidden rounded-xl" :ui="{ header: 'p-3 sm:px-3', body: 'px-3 py-1 sm:px-3', footer: 'p-3 sm:px-3' }">
        <template #header>
          <div class="flex items-center gap-2">
            <UAvatar :src="child.avatarUrl" :alt="childName(child)" size="md" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h2 :id="`child-name-${child.id}`" class="truncate font-semibold">{{ childName(child) }}</h2>
                <UBadge v-if="child.isAdmin" color="primary" variant="soft">Admin</UBadge>
              </div>
              <p v-if="child.displayName" class="truncate text-xs text-[var(--zt-muted)]">{{ child.email }}</p>
            </div>
            <UButton v-if="child.policy" size="sm" variant="soft" :color="isPaused(child) ? 'primary' : 'neutral'"
              class="min-h-11 shrink-0" :disabled="pending" @click="togglePause(child)">
              {{ isPaused(child) ? 'Resume today' : 'Pause today' }}
            </UButton>
          </div>
          <p v-if="child.policy" class="mt-2 break-words text-sm font-medium" :title="viewingStatus(child)">{{ viewingStatus(child) }}</p>
        </template>

        <ul v-if="child.pools?.length" aria-label="Time Pool balances" class="divide-y divide-[var(--zt-border)]">
          <li v-for="pool in child.pools" :key="pool.id" class="flex min-h-11 items-center gap-2">
            <span class="min-w-0 flex-1 break-words text-sm">{{ pool.name }}</span>
            <span class="shrink-0 text-xs tabular-nums text-[var(--zt-muted)]">{{ pool.locked ? '0 min left' : `${Math.ceil(pool.remainingSeconds / 60)} min left` }}</span>
            <UButton size="sm" variant="ghost" class="min-h-11 min-w-11 shrink-0" :disabled="pending"
              :aria-label="`Add 15 minutes to ${pool.name} today`" @click="extendPool(child, pool)">+15 min</UButton>
          </li>
        </ul>

        <template #footer>
          <div class="grid grid-cols-2 gap-2">
            <UButton :to="`/admin/child/${child.id}/manage`" block variant="soft" class="min-h-11">Manage child</UButton>
            <UButton :to="`/admin/child/${child.id}/preview`" block variant="outline" class="min-h-11">Preview viewer</UButton>
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
