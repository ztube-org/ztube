<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data: childrenData, refresh } = await useFetch('/api/parent/children')

const showCreateModal = ref(false)
const createForm = reactive({
  username: '',
  password: '',
  displayName: '',
})
const createError = ref('')
const createLoading = ref(false)

async function createChild() {
  createError.value = ''
  createLoading.value = true

  try {
    await $fetch('/api/parent/children', {
      method: 'POST',
      body: createForm,
    })
    showCreateModal.value = false
    createForm.username = ''
    createForm.password = ''
    createForm.displayName = ''
    await refresh()
  } catch (e: any) {
    createError.value = e.data?.message || 'Failed to create child'
  } finally {
    createLoading.value = false
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-bold">My Children</h1>
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

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <UCard v-for="child in childrenData?.children" :key="child.id">
        <template #header>
          <div class="flex items-center gap-3">
            <UAvatar :alt="child.displayName || child.username" size="lg" />
            <div>
              <h3 class="font-semibold">{{ child.displayName || child.username }}</h3>
              <p class="text-sm text-gray-500">@{{ child.username }}</p>
            </div>
          </div>
        </template>

        <div class="flex gap-4 text-sm text-gray-600 dark:text-gray-300">
          <span>{{ child.stats.channels }} channels</span>
          <span>{{ child.stats.playlists }} playlists</span>
          <span>{{ child.stats.videos }} videos</span>
        </div>

        <template #footer>
          <NuxtLink :to="`/parent/child/${child.id}/manage`">
            <UButton block variant="soft">
              Manage Content
            </UButton>
          </NuxtLink>
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
          <UFormGroup label="Username">
            <UInput v-model="createForm.username" placeholder="Child's username" required />
          </UFormGroup>

          <UFormGroup label="Password">
            <UInput v-model="createForm.password" type="password" placeholder="Password (8+ chars)" required />
          </UFormGroup>

          <UFormGroup label="Display Name (optional)">
            <UInput v-model="createForm.displayName" placeholder="Friendly name" />
          </UFormGroup>

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
