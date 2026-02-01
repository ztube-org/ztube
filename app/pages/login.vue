<script setup lang="ts">
definePageMeta({ layout: false })

const { login } = useAuth()

const form = reactive({
  username: '',
  password: '',
})
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  loading.value = true

  try {
    const response = await login(form.username, form.password)
    await navigateTo(response.redirect)
  } catch (e: any) {
    error.value = e.data?.message || 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">ZTube</h1>
        <p class="text-center text-gray-500">Sign in to your account</p>
      </template>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <UFormGroup label="Username">
          <UInput v-model="form.username" placeholder="Enter username" required />
        </UFormGroup>

        <UFormGroup label="Password">
          <UInput v-model="form.password" type="password" placeholder="Enter password" required />
        </UFormGroup>

        <UAlert v-if="error" color="red" :title="error" />

        <UButton type="submit" block :loading="loading">
          Sign In
        </UButton>
      </form>

      <template #footer>
        <p class="text-center text-sm text-gray-500">
          Don't have an account?
          <NuxtLink to="/register" class="text-primary-500 hover:underline">
            Register
          </NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>
