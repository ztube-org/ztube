<script setup lang="ts">
import { reactive, ref } from 'vue'
import { apiFetch, useApi } from '../../../src/api'

const { data: childrenData, refresh } = useApi<any>('/api/parent/children')

const showCreateModal = ref(false)
const createForm = reactive({
  email: '',
  displayName: '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
})
const createError = ref('')
const createLoading = ref(false)

async function createChild() {
  createError.value = ''
  createLoading.value = true

  try {
    await apiFetch('/api/parent/children', {
      method: 'POST',
      body: createForm,
    })
    showCreateModal.value = false
    createForm.email = ''
    createForm.displayName = ''
    await refresh()
  } catch (e: any) {
    createError.value = e.data?.message || 'Failed to create child'
  } finally {
    createLoading.value = false
  }
}

async function deleteChild(child: { id: number; displayName: string | null; email: string }) {
  const name = child.displayName || child.email
  if (!confirm(`Permanently delete ${name}?\n\nThis removes all Approved Content, Content Rules, Daily Usage Summaries, Temporary Extensions, and Active Playback. It cannot be undone.`)) return
  await apiFetch(`/api/parent/children/${child.id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="zt-page">
    <div class="mb-8 flex items-end justify-between gap-4">
      <div>
        <p class="mb-1 text-sm font-medium text-[#065fd4]">Family dashboard</p>
        <h1 class="text-3xl font-bold tracking-tight">My Children</h1>
      </div>
      <UButton @click="showCreateModal = true">
        Add Child Account
      </UButton>
    </div>

    <div v-if="childrenData?.children?.length === 0" class="text-center py-12">
      <UIcon name="i-heroicons-users" class="w-16 h-16 mx-auto text-gray-400 mb-4" />
      <p class="text-gray-500 mb-4">No child accounts yet</p>
      <UButton @click="showCreateModal = true">
        Create First Child Account
      </UButton>
    </div>

    <div v-else class="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <UCard v-for="child in childrenData?.children" :key="child.id" class="overflow-hidden rounded-2xl ring-1 ring-gray-200 transition hover:shadow-md">
        <template #header>
          <div class="flex items-center gap-3">
            <UAvatar :alt="child.displayName || child.email" size="lg" />
            <div>
              <h3 class="font-semibold">{{ child.displayName || child.email }}</h3>
              <p class="text-sm text-gray-500">{{ child.email }}</p>
            </div>
          </div>
        </template>

        <div class="grid grid-cols-3 divide-x divide-gray-200 text-center text-sm">
          <span><strong class="block text-lg text-[#0f0f0f]">{{ child.stats.channels }}</strong><span class="text-[#606060]">channels</span></span>
          <span><strong class="block text-lg text-[#0f0f0f]">{{ child.stats.playlists }}</strong><span class="text-[#606060]">playlists</span></span>
          <span><strong class="block text-lg text-[#0f0f0f]">{{ child.stats.videos }}</strong><span class="text-[#606060]">videos</span></span>
        </div>

        <template #footer>
          <div class="flex gap-2">
            <NuxtLink class="flex-1" :to="`/parent/child/${child.id}/manage`">
              <UButton block variant="soft">
              Manage Content
              </UButton>
            </NuxtLink>
            <UButton color="neutral" variant="ghost" icon="i-heroicons-trash" @click="deleteChild(child)">
              Delete
            </UButton>
          </div>
        </template>
      </UCard>
    </div>

    <!-- Create Child Modal -->
    <UModal v-model="showCreateModal">
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold">Create Child Account</h2>
        </template>

        <form @submit.prevent="createChild" class="space-y-4">
          <UFormField label="Child's Google email">
            <UInput v-model="createForm.email" type="email" placeholder="child@example.com" required />
          </UFormField>

          <UFormField label="Display Name (optional)">
            <UInput v-model="createForm.displayName" placeholder="Friendly name" />
          </UFormField>

          <UAlert v-if="createError" color="red" :title="createError" />

          <div class="flex gap-2 justify-end">
            <UButton color="gray" variant="ghost" @click="showCreateModal = false">
              Cancel
            </UButton>
            <UButton type="submit" :loading="createLoading">
              Create
            </UButton>
          </div>
        </form>
      </UCard>
    </UModal>
  </div>
</template>
