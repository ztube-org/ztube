<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data, refresh } = await useFetch('/api/admin/parents')

const showResetModal = ref(false)
const selectedParent = ref<{ id: number; username: string } | null>(null)
const newPassword = ref('')
const resetLoading = ref(false)
const resetError = ref('')

function openResetModal(parent: { id: number; username: string }) {
  selectedParent.value = parent
  newPassword.value = ''
  resetError.value = ''
  showResetModal.value = true
}

async function resetPassword() {
  if (!selectedParent.value) return
  resetError.value = ''
  resetLoading.value = true

  try {
    await $fetch(`/api/admin/parents/${selectedParent.value.id}/reset-password`, {
      method: 'POST',
      body: { newPassword: newPassword.value },
    })
    showResetModal.value = false
    alert(`Password reset for ${selectedParent.value.username}`)
  } catch (e: any) {
    resetError.value = e.data?.message || 'Failed to reset password'
  } finally {
    resetLoading.value = false
  }
}

function formatDate(date: Date | string | null): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString()
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-8">Admin Panel</h1>

    <UCard>
      <template #header>
        <h2 class="font-semibold">Parent Accounts</h2>
      </template>

      <UTable
        :columns="[
          { key: 'username', label: 'Username' },
          { key: 'childrenCount', label: 'Children' },
          { key: 'createdAt', label: 'Created' },
          { key: 'actions', label: '' },
        ]"
        :rows="data?.parents || []"
      >
        <template #createdAt-data="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
        <template #actions-data="{ row }">
          <UButton size="xs" variant="soft" @click="openResetModal(row)">
            Reset Password
          </UButton>
        </template>
      </UTable>

      <div v-if="!data?.parents?.length" class="text-center py-8 text-gray-500">
        No parent accounts yet
      </div>
    </UCard>

    <!-- Reset Password Modal -->
    <UModal v-model="showResetModal">
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold">Reset Password</h2>
        </template>

        <form @submit.prevent="resetPassword" class="space-y-4">
          <p class="text-gray-600 dark:text-gray-300">
            Reset password for <strong>{{ selectedParent?.username }}</strong>
          </p>

          <UFormGroup label="New Password">
            <UInput v-model="newPassword" type="password" placeholder="New password (8+ chars)" required />
          </UFormGroup>

          <UAlert v-if="resetError" color="red" :title="resetError" />

          <div class="flex gap-2 justify-end">
            <UButton color="gray" variant="ghost" @click="showResetModal = false">
              Cancel
            </UButton>
            <UButton type="submit" :loading="resetLoading">
              Reset Password
            </UButton>
          </div>
        </form>
      </UCard>
    </UModal>
  </div>
</template>
