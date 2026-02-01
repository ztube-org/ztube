<script setup lang="ts">
const { user, loading, fetchSession } = useAuth()

onMounted(async () => {
  await fetchSession()

  if (!user.value) {
    await navigateTo('/login')
    return
  }

  switch (user.value.role) {
    case 'superadmin':
      await navigateTo('/admin')
      break
    case 'parent':
      await navigateTo('/parent/dashboard')
      break
    case 'child':
      await navigateTo('/browse')
      break
    default:
      await navigateTo('/login')
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
  </div>
</template>
