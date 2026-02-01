<script setup lang="ts">
definePageMeta({ layout: false })

const { register } = useAuth()

const form = reactive({
  invitationCode: '',
  username: '',
  password: '',
  confirmPassword: '',
})
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''

  if (form.password !== form.confirmPassword) {
    error.value = 'Passwords do not match'
    return
  }

  if (form.password.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }

  loading.value = true

  try {
    const response = await register(form.invitationCode, form.username, form.password)
    await navigateTo(response.redirect)
  } catch (e: any) {
    error.value = e.data?.message || 'Registration failed'
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
        <p class="text-center text-gray-500">Create a parent account</p>
      </template>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <UFormGroup label="Invitation Code">
          <UInput v-model="form.invitationCode" placeholder="Enter invitation code" required />
        </UFormGroup>

        <UFormGroup label="Username">
          <UInput v-model="form.username" placeholder="Choose a username" required />
        </UFormGroup>

        <UFormGroup label="Password">
          <UInput v-model="form.password" type="password" placeholder="Choose a password (8+ chars)" required />
        </UFormGroup>

        <UFormGroup label="Confirm Password">
          <UInput v-model="form.confirmPassword" type="password" placeholder="Confirm password" required />
        </UFormGroup>

        <UAlert v-if="error" color="red" :title="error" />

        <UButton type="submit" block :loading="loading">
          Create Account
        </UButton>
      </form>

      <template #footer>
        <p class="text-center text-sm text-gray-500">
          Already have an account?
          <NuxtLink to="/login" class="text-primary-500 hover:underline">
            Sign In
          </NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>
