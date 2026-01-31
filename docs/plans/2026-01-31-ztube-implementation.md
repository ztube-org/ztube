# ZTube Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a parental control YouTube platform where parents curate allowlists of channels, playlists, and videos for their children to watch in a clean, distraction-free interface.

**Architecture:** Nuxt 3 full-stack app with server routes for API, Drizzle ORM with SQLite/D1 for database, YouTube Data API v3 for content metadata, and Nuxt UI for components. Three user roles (superadmin, parent, child) with session-based auth.

**Tech Stack:** Nuxt 3, Vue 3, Drizzle ORM, SQLite/D1, Nuxt UI, Tailwind CSS, bcrypt, zod, oxlint

---

## Phase 1: Project Scaffolding

### Task 1.1: Initialize Nuxt Project

**Files:**
- Create: `package.json`
- Create: `nuxt.config.ts`
- Create: `tsconfig.json`
- Create: `app/app.vue`

**Step 1: Create Nuxt project**

Run:
```bash
cd /path/to/ztube/.worktrees/implement-ztube
npx nuxi@latest init . --force --packageManager npm
```

**Step 2: Verify project created**

Run: `ls -la`
Expected: package.json, nuxt.config.ts, app.vue or app/app.vue exists

**Step 3: Install dependencies**

Run: `npm install`
Expected: node_modules created, no errors

**Step 4: Test dev server starts**

Run: `npm run dev -- --port 3333 &`
Wait 5 seconds, then: `curl -s http://localhost:3333 | head -20`
Expected: HTML response with Nuxt content
Then: `pkill -f "nuxt dev"`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: initialize Nuxt 3 project"
```

---

### Task 1.2: Add Core Dependencies

**Files:**
- Modify: `package.json`
- Create: `.env.example`

**Step 1: Install production dependencies**

Run:
```bash
npm install @nuxt/ui drizzle-orm better-sqlite3 bcrypt zod
```

**Step 2: Install dev dependencies**

Run:
```bash
npm install -D drizzle-kit @types/better-sqlite3 @types/bcrypt oxlint
```

**Step 3: Create .env.example**

Create file `.env.example`:
```env
# Admin Configuration
SUPERADMIN_PASSWORD=change-me-in-production

# Registration
INVITATION_CODE=change-me-secret-code

# YouTube API
YOUTUBE_API_KEY=your-youtube-api-key

# Database (local development)
DATABASE_URL=file:./dev.db

# Session
NUXT_SESSION_PASSWORD=at-least-32-characters-long-secret-key
```

**Step 4: Create .env from example**

Run: `cp .env.example .env`

**Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat: add core dependencies and env template"
```

---

### Task 1.3: Configure Nuxt

**Files:**
- Modify: `nuxt.config.ts`

**Step 1: Read current nuxt.config.ts**

Read the file to see current contents.

**Step 2: Update nuxt.config.ts**

Replace with:
```typescript
export default defineNuxtConfig({
  compatibilityDate: '2024-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui'],

  runtimeConfig: {
    superadminPassword: process.env.SUPERADMIN_PASSWORD || '',
    invitationCode: process.env.INVITATION_CODE || '',
    youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
    sessionPassword: process.env.NUXT_SESSION_PASSWORD || '',
  },

  nitro: {
    preset: 'cloudflare-pages',
  },

  future: {
    compatibilityVersion: 4,
  },
})
```

**Step 3: Verify config is valid**

Run: `npm run dev -- --port 3333 &`
Wait 5 seconds, check no errors in output.
Then: `pkill -f "nuxt dev"`

**Step 4: Commit**

```bash
git add nuxt.config.ts
git commit -m "feat: configure Nuxt with UI module and runtime config"
```

---

### Task 1.4: Configure Drizzle ORM

**Files:**
- Create: `drizzle.config.ts`
- Create: `server/database/index.ts`

**Step 1: Create drizzle.config.ts**

Create file `drizzle.config.ts`:
```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
})
```

**Step 2: Create server/database directory**

Run: `mkdir -p server/database`

**Step 3: Create server/database/index.ts**

Create file `server/database/index.ts`:
```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as schema from './schema'

const sqlite = new Database(process.env.DATABASE_URL?.replace('file:', '') || './dev.db')
export const db = drizzle(sqlite, { schema })
```

**Step 4: Add db scripts to package.json**

Read package.json, then add to "scripts":
```json
"db:push": "drizzle-kit push",
"db:generate": "drizzle-kit generate",
"db:studio": "drizzle-kit studio"
```

**Step 5: Commit**

```bash
git add drizzle.config.ts server/database/index.ts package.json
git commit -m "feat: configure Drizzle ORM for SQLite"
```

---

### Task 1.5: Create Database Schema

**Files:**
- Create: `server/database/schema.ts`

**Step 1: Create schema file**

Create file `server/database/schema.ts`:
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Parents table
export const parents = sqliteTable('parents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Children table
export const children = sqliteTable('children', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id').notNull().references(() => parents.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed channels
export const allowedChannels = sqliteTable('allowed_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id),
  channelId: text('channel_id').notNull(),
  channelTitle: text('channel_title').notNull(),
  channelThumbnail: text('channel_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed playlists
export const allowedPlaylists = sqliteTable('allowed_playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id),
  playlistId: text('playlist_id').notNull(),
  playlistTitle: text('playlist_title').notNull(),
  playlistThumbnail: text('playlist_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed videos
export const allowedVideos = sqliteTable('allowed_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Channel videos cache
export const channelVideos = sqliteTable('channel_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull(),
  videoId: text('video_id').notNull(),
  position: integer('position'),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Playlist videos cache
export const playlistVideos = sqliteTable('playlist_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: text('playlist_id').notNull(),
  videoId: text('video_id').notNull(),
  position: integer('position'),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Type exports
export type Parent = typeof parents.$inferSelect
export type NewParent = typeof parents.$inferInsert
export type Child = typeof children.$inferSelect
export type NewChild = typeof children.$inferInsert
export type AllowedChannel = typeof allowedChannels.$inferSelect
export type AllowedPlaylist = typeof allowedPlaylists.$inferSelect
export type AllowedVideo = typeof allowedVideos.$inferSelect
```

**Step 2: Push schema to database**

Run: `npm run db:push`
Expected: Tables created successfully

**Step 3: Verify database exists**

Run: `ls -la *.db`
Expected: dev.db file exists

**Step 4: Commit**

```bash
git add server/database/schema.ts
git commit -m "feat: add database schema for all tables"
```

---

### Task 1.6: Setup oxlint

**Files:**
- Create: `oxlint.json`
- Modify: `package.json`

**Step 1: Create oxlint.json**

Create file `oxlint.json`:
```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off"
  }
}
```

**Step 2: Add lint script to package.json**

Add to scripts in package.json:
```json
"lint": "oxlint ."
```

**Step 3: Run lint to verify**

Run: `npm run lint`
Expected: No errors (warnings OK)

**Step 4: Commit**

```bash
git add oxlint.json package.json
git commit -m "feat: configure oxlint for linting"
```

---

## Phase 2: Authentication System

### Task 2.1: Create Auth Utilities

**Files:**
- Create: `server/utils/auth.ts`
- Create: `server/utils/password.ts`

**Step 1: Create password utility**

Create file `server/utils/password.ts`:
```typescript
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 10

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
```

**Step 2: Create auth utility**

Create file `server/utils/auth.ts`:
```typescript
import { H3Event } from 'h3'

export type UserRole = 'superadmin' | 'parent' | 'child'

export interface SessionUser {
  id: number | null
  username: string
  role: UserRole
}

export function getSessionUser(event: H3Event): SessionUser | null {
  const session = event.context.session
  if (!session?.user) return null
  return session.user as SessionUser
}

export function requireAuth(event: H3Event): SessionUser {
  const user = getSessionUser(event)
  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }
  return user
}

export function requireRole(event: H3Event, roles: UserRole[]): SessionUser {
  const user = requireAuth(event)
  if (!roles.includes(user.role)) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }
  return user
}
```

**Step 3: Commit**

```bash
git add server/utils/password.ts server/utils/auth.ts
git commit -m "feat: add auth and password utilities"
```

---

### Task 2.2: Create Session Middleware

**Files:**
- Create: `server/middleware/session.ts`
- Create: `server/plugins/session.ts`

**Step 1: Install h3-session compatible library**

Run: `npm install iron-webcrypto`

**Step 2: Create session plugin**

Create file `server/plugins/session.ts`:
```typescript
import { sealData, unsealData } from 'iron-webcrypto'

const COOKIE_NAME = 'ztube_session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', async (event) => {
    const config = useRuntimeConfig()
    const password = config.sessionPassword

    if (!password || password.length < 32) {
      console.warn('Session password not set or too short')
      event.context.session = {}
      return
    }

    const cookie = getCookie(event, COOKIE_NAME)

    if (cookie) {
      try {
        const data = await unsealData(cookie, { password, ttl: COOKIE_MAX_AGE })
        event.context.session = data as Record<string, unknown>
      } catch {
        event.context.session = {}
      }
    } else {
      event.context.session = {}
    }
  })
})

export async function setSession(event: H3Event, data: Record<string, unknown>) {
  const config = useRuntimeConfig()
  const password = config.sessionPassword

  const sealed = await sealData(data, { password, ttl: COOKIE_MAX_AGE })

  setCookie(event, COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  event.context.session = data
}

export async function clearSession(event: H3Event) {
  deleteCookie(event, COOKIE_NAME)
  event.context.session = {}
}
```

**Step 3: Update .env with session password**

Edit `.env` and set a valid session password (32+ chars).

**Step 4: Commit**

```bash
git add server/plugins/session.ts package.json package-lock.json
git commit -m "feat: add session management with encrypted cookies"
```

---

### Task 2.3: Create Login API

**Files:**
- Create: `server/api/auth/login.post.ts`

**Step 1: Create login endpoint**

Create file `server/api/auth/login.post.ts`:
```typescript
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { parents, children } from '~/server/database/schema'
import { verifyPassword } from '~/server/utils/password'
import { setSession } from '~/server/plugins/session'
import type { SessionUser } from '~/server/utils/auth'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, password } = loginSchema.parse(body)

  const config = useRuntimeConfig()

  // Check superadmin
  if (username === 'superadmin') {
    if (password === config.superadminPassword) {
      const user: SessionUser = { id: null, username: 'superadmin', role: 'superadmin' }
      await setSession(event, { user })
      return { success: true, redirect: '/admin' }
    }
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  // Check parents
  const parent = await db.query.parents.findFirst({
    where: eq(parents.username, username),
  })

  if (parent && await verifyPassword(password, parent.passwordHash)) {
    const user: SessionUser = { id: parent.id, username: parent.username, role: 'parent' }
    await setSession(event, { user })
    return { success: true, redirect: '/parent/dashboard' }
  }

  // Check children
  const child = await db.query.children.findFirst({
    where: eq(children.username, username),
  })

  if (child && await verifyPassword(password, child.passwordHash)) {
    const user: SessionUser = { id: child.id, username: child.username, role: 'child' }
    await setSession(event, { user })
    return { success: true, redirect: '/browse' }
  }

  throw createError({ statusCode: 401, message: 'Invalid credentials' })
})
```

**Step 2: Commit**

```bash
git add server/api/auth/login.post.ts
git commit -m "feat: add login API endpoint"
```

---

### Task 2.4: Create Register API

**Files:**
- Create: `server/api/auth/register.post.ts`

**Step 1: Create register endpoint**

Create file `server/api/auth/register.post.ts`:
```typescript
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { parents } from '~/server/database/schema'
import { hashPassword } from '~/server/utils/password'
import { setSession } from '~/server/plugins/session'
import type { SessionUser } from '~/server/utils/auth'

const registerSchema = z.object({
  invitationCode: z.string().min(1),
  username: z.string().min(3).max(50),
  password: z.string().min(8),
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { invitationCode, username, password } = registerSchema.parse(body)

  const config = useRuntimeConfig()

  // Verify invitation code
  if (invitationCode !== config.invitationCode) {
    throw createError({ statusCode: 400, message: 'Invalid invitation code' })
  }

  // Check username availability
  const existing = await db.query.parents.findFirst({
    where: eq(parents.username, username),
  })

  if (existing) {
    throw createError({ statusCode: 400, message: 'Username already exists' })
  }

  // Create parent account
  const passwordHash = await hashPassword(password)
  const [newParent] = await db.insert(parents).values({
    username,
    passwordHash,
  }).returning()

  // Auto-login
  const user: SessionUser = { id: newParent.id, username: newParent.username, role: 'parent' }
  await setSession(event, { user })

  return { success: true, redirect: '/parent/dashboard' }
})
```

**Step 2: Commit**

```bash
git add server/api/auth/register.post.ts
git commit -m "feat: add registration API with invitation code"
```

---

### Task 2.5: Create Logout and Session APIs

**Files:**
- Create: `server/api/auth/logout.post.ts`
- Create: `server/api/auth/session.get.ts`

**Step 1: Create logout endpoint**

Create file `server/api/auth/logout.post.ts`:
```typescript
import { clearSession } from '~/server/plugins/session'

export default defineEventHandler(async (event) => {
  await clearSession(event)
  return { success: true, redirect: '/login' }
})
```

**Step 2: Create session endpoint**

Create file `server/api/auth/session.get.ts`:
```typescript
import { getSessionUser } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const user = getSessionUser(event)
  return { user }
})
```

**Step 3: Commit**

```bash
git add server/api/auth/logout.post.ts server/api/auth/session.get.ts
git commit -m "feat: add logout and session check APIs"
```

---

### Task 2.6: Create Auth Composable

**Files:**
- Create: `app/composables/useAuth.ts`

**Step 1: Create composable**

Create file `app/composables/useAuth.ts`:
```typescript
import type { SessionUser } from '~/server/utils/auth'

export function useAuth() {
  const user = useState<SessionUser | null>('auth-user', () => null)
  const loading = useState('auth-loading', () => true)

  async function fetchSession() {
    loading.value = true
    try {
      const { data } = await useFetch('/api/auth/session')
      user.value = data.value?.user || null
    } finally {
      loading.value = false
    }
  }

  async function login(username: string, password: string) {
    const response = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    await fetchSession()
    return response
  }

  async function register(invitationCode: string, username: string, password: string) {
    const response = await $fetch('/api/auth/register', {
      method: 'POST',
      body: { invitationCode, username, password },
    })
    await fetchSession()
    return response
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo('/login')
  }

  return {
    user: readonly(user),
    loading: readonly(loading),
    fetchSession,
    login,
    register,
    logout,
  }
}
```

**Step 2: Commit**

```bash
git add app/composables/useAuth.ts
git commit -m "feat: add useAuth composable for client auth"
```

---

## Phase 3: Core Pages

### Task 3.1: Create Login Page

**Files:**
- Create: `app/pages/login.vue`

**Step 1: Create login page**

Create file `app/pages/login.vue`:
```vue
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
```

**Step 2: Commit**

```bash
git add app/pages/login.vue
git commit -m "feat: add login page"
```

---

### Task 3.2: Create Register Page

**Files:**
- Create: `app/pages/register.vue`

**Step 1: Create register page**

Create file `app/pages/register.vue`:
```vue
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
```

**Step 2: Commit**

```bash
git add app/pages/register.vue
git commit -m "feat: add registration page"
```

---

### Task 3.3: Create Index Page (Redirect)

**Files:**
- Modify: `app/app.vue`
- Create: `app/pages/index.vue`

**Step 1: Update app.vue**

Read current app.vue, then replace with:
```vue
<template>
  <NuxtPage />
</template>
```

**Step 2: Create index page with redirect**

Create file `app/pages/index.vue`:
```vue
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
```

**Step 3: Commit**

```bash
git add app/app.vue app/pages/index.vue
git commit -m "feat: add index page with role-based redirect"
```

---

### Task 3.4: Create Default Layout

**Files:**
- Create: `app/layouts/default.vue`

**Step 1: Create default layout**

Create file `app/layouts/default.vue`:
```vue
<script setup lang="ts">
const { user, logout } = useAuth()
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <header class="bg-white dark:bg-gray-800 shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <NuxtLink to="/" class="text-xl font-bold text-primary-500">
          ZTube
        </NuxtLink>

        <div v-if="user" class="flex items-center gap-4">
          <span class="text-sm text-gray-600 dark:text-gray-300">
            {{ user.username }}
          </span>
          <UButton color="gray" variant="ghost" @click="logout">
            Logout
          </UButton>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-8">
      <slot />
    </main>
  </div>
</template>
```

**Step 2: Commit**

```bash
git add app/layouts/default.vue
git commit -m "feat: add default layout with header"
```

---

## Phase 4: Parent Features

### Task 4.1: Create Parent Dashboard API

**Files:**
- Create: `server/api/parent/children.get.ts`
- Create: `server/api/parent/children.post.ts`

**Step 1: Create get children endpoint**

Create file `server/api/parent/children.get.ts`:
```typescript
import { eq, count } from 'drizzle-orm'
import { db } from '~/server/database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])

  const childList = await db.query.children.findMany({
    where: eq(children.parentId, user.id!),
  })

  // Get content counts for each child
  const childrenWithStats = await Promise.all(
    childList.map(async (child) => {
      const [channelCount] = await db.select({ count: count() }).from(allowedChannels).where(eq(allowedChannels.childId, child.id))
      const [playlistCount] = await db.select({ count: count() }).from(allowedPlaylists).where(eq(allowedPlaylists.childId, child.id))
      const [videoCount] = await db.select({ count: count() }).from(allowedVideos).where(eq(allowedVideos.childId, child.id))

      return {
        id: child.id,
        username: child.username,
        displayName: child.displayName,
        createdAt: child.createdAt,
        stats: {
          channels: channelCount.count,
          playlists: playlistCount.count,
          videos: videoCount.count,
        },
      }
    })
  )

  return { children: childrenWithStats }
})
```

**Step 2: Create add child endpoint**

Create file `server/api/parent/children.post.ts`:
```typescript
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { children } from '~/server/database/schema'
import { hashPassword } from '~/server/utils/password'
import { requireRole } from '~/server/utils/auth'

const createChildSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  displayName: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const body = await readBody(event)
  const { username, password, displayName } = createChildSchema.parse(body)

  // Check username availability
  const existing = await db.query.children.findFirst({
    where: eq(children.username, username),
  })

  if (existing) {
    throw createError({ statusCode: 400, message: 'Username already exists' })
  }

  const passwordHash = await hashPassword(password)
  const [newChild] = await db.insert(children).values({
    parentId: user.id!,
    username,
    passwordHash,
    displayName: displayName || null,
  }).returning()

  return {
    id: newChild.id,
    username: newChild.username,
    displayName: newChild.displayName,
  }
})
```

**Step 3: Commit**

```bash
git add server/api/parent/children.get.ts server/api/parent/children.post.ts
git commit -m "feat: add parent children management APIs"
```

---

### Task 4.2: Create Parent Dashboard Page

**Files:**
- Create: `app/pages/parent/dashboard.vue`

**Step 1: Create dashboard page**

Create file `app/pages/parent/dashboard.vue`:
```vue
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
```

**Step 2: Commit**

```bash
git add app/pages/parent/dashboard.vue
git commit -m "feat: add parent dashboard page"
```

---

### Task 4.3: Create Auth Middleware

**Files:**
- Create: `app/middleware/auth.ts`

**Step 1: Create middleware**

Create file `app/middleware/auth.ts`:
```typescript
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchSession } = useAuth()

  await fetchSession()

  if (!user.value) {
    return navigateTo('/login')
  }

  // Role-based route protection
  const path = to.path

  if (path.startsWith('/admin') && user.value.role !== 'superadmin') {
    return navigateTo('/')
  }

  if (path.startsWith('/parent') && user.value.role !== 'parent') {
    return navigateTo('/')
  }

  if (path.startsWith('/browse') && user.value.role !== 'child') {
    return navigateTo('/')
  }
})
```

**Step 2: Commit**

```bash
git add app/middleware/auth.ts
git commit -m "feat: add auth middleware with role protection"
```

---

---

## Phase 5: YouTube API Integration

### Task 5.1: Create YouTube URL Parser

**Files:**
- Create: `server/utils/youtube.ts`

**Step 1: Create YouTube utility**

Create file `server/utils/youtube.ts`:
```typescript
import { z } from 'zod'

export type YouTubeContentType = 'video' | 'playlist' | 'channel'

export interface ParsedYouTubeUrl {
  type: YouTubeContentType
  id: string
}

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl | null {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.replace('www.', '')

    // Video URLs
    if (hostname === 'youtube.com' || hostname === 'youtu.be') {
      // youtu.be/VIDEO_ID
      if (hostname === 'youtu.be') {
        const videoId = urlObj.pathname.slice(1)
        if (videoId) return { type: 'video', id: videoId }
      }

      // youtube.com/watch?v=VIDEO_ID
      const videoId = urlObj.searchParams.get('v')
      if (videoId) return { type: 'video', id: videoId }

      // youtube.com/playlist?list=PLAYLIST_ID
      const playlistId = urlObj.searchParams.get('list')
      if (playlistId && !videoId) return { type: 'playlist', id: playlistId }

      // youtube.com/channel/CHANNEL_ID
      const channelMatch = urlObj.pathname.match(/^\/channel\/([^/]+)/)
      if (channelMatch) return { type: 'channel', id: channelMatch[1] }

      // youtube.com/@USERNAME
      const handleMatch = urlObj.pathname.match(/^\/@([^/]+)/)
      if (handleMatch) return { type: 'channel', id: `@${handleMatch[1]}` }

      // youtube.com/c/CUSTOMNAME
      const customMatch = urlObj.pathname.match(/^\/c\/([^/]+)/)
      if (customMatch) return { type: 'channel', id: `c/${customMatch[1]}` }
    }

    return null
  } catch {
    return null
  }
}

// YouTube API response schemas
export const videoSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    thumbnails: z.object({
      medium: z.object({ url: z.string() }).optional(),
      default: z.object({ url: z.string() }).optional(),
    }),
  }),
  contentDetails: z.object({
    duration: z.string(),
  }).optional(),
})

export const playlistSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    thumbnails: z.object({
      medium: z.object({ url: z.string() }).optional(),
      default: z.object({ url: z.string() }).optional(),
    }),
  }),
})

export const channelSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    thumbnails: z.object({
      medium: z.object({ url: z.string() }).optional(),
      default: z.object({ url: z.string() }).optional(),
    }),
  }),
})

// Parse ISO 8601 duration to seconds
export function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

// Format seconds to display string
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}
```

**Step 2: Commit**

```bash
git add server/utils/youtube.ts
git commit -m "feat: add YouTube URL parser and utilities"
```

---

### Task 5.2: Create YouTube API Fetcher

**Files:**
- Create: `server/utils/youtube-api.ts`

**Step 1: Create API fetcher**

Create file `server/utils/youtube-api.ts`:
```typescript
import { parseDuration } from './youtube'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

function getApiKey() {
  const config = useRuntimeConfig()
  if (!config.youtubeApiKey) {
    throw createError({ statusCode: 500, message: 'YouTube API key not configured' })
  }
  return config.youtubeApiKey
}

export interface VideoMetadata {
  videoId: string
  title: string
  thumbnail: string
  duration: number
  channelTitle: string
}

export interface PlaylistMetadata {
  playlistId: string
  title: string
  thumbnail: string
}

export interface ChannelMetadata {
  channelId: string
  title: string
  thumbnail: string
}

export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const apiKey = getApiKey()
  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items || data.items.length === 0) {
    throw createError({ statusCode: 404, message: 'Video not found' })
  }

  const item = data.items[0]
  return {
    videoId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    duration: parseDuration(item.contentDetails?.duration || 'PT0S'),
    channelTitle: item.snippet.channelTitle,
  }
}

export async function fetchPlaylistMetadata(playlistId: string): Promise<PlaylistMetadata> {
  const apiKey = getApiKey()
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items || data.items.length === 0) {
    throw createError({ statusCode: 404, message: 'Playlist not found' })
  }

  const item = data.items[0]
  return {
    playlistId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchChannelMetadata(channelId: string): Promise<ChannelMetadata> {
  const apiKey = getApiKey()

  // Handle @username and c/customname formats
  let url: string
  if (channelId.startsWith('@')) {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet&forHandle=${channelId}&key=${apiKey}`
  } else if (channelId.startsWith('c/')) {
    // For custom URLs, we need to search
    const customName = channelId.slice(2)
    url = `${YOUTUBE_API_BASE}/search?part=snippet&type=channel&q=${customName}&key=${apiKey}`
  } else {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet&id=${channelId}&key=${apiKey}`
  }

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items || data.items.length === 0) {
    throw createError({ statusCode: 404, message: 'Channel not found' })
  }

  const item = data.items[0]
  const actualChannelId = item.id.channelId || item.id

  return {
    channelId: actualChannelId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchPlaylistVideos(playlistId: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = getApiKey()
  const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items) {
    return []
  }

  // Get video IDs to fetch duration info
  const videoIds = data.items.map((item: any) => item.contentDetails.videoId).join(',')

  if (!videoIds) return []

  const videosUrl = `${YOUTUBE_API_BASE}/videos?part=contentDetails&id=${videoIds}&key=${apiKey}`
  const videosResponse = await fetch(videosUrl)
  const videosData = await videosResponse.json()

  const durationMap = new Map<string, number>()
  for (const video of videosData.items || []) {
    durationMap.set(video.id, parseDuration(video.contentDetails?.duration || 'PT0S'))
  }

  return data.items.map((item: any, index: number) => ({
    videoId: item.contentDetails.videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    duration: durationMap.get(item.contentDetails.videoId) || 0,
    channelTitle: item.snippet.channelTitle || '',
    position: index,
  }))
}

export async function fetchChannelVideos(channelId: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = getApiKey()

  // First get the uploads playlist ID
  const channelUrl = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
  const channelResponse = await fetch(channelUrl)
  const channelData = await channelResponse.json()

  if (!channelData.items || channelData.items.length === 0) {
    return []
  }

  const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads

  // Then fetch videos from uploads playlist
  return fetchPlaylistVideos(uploadsPlaylistId, maxResults)
}
```

**Step 2: Commit**

```bash
git add server/utils/youtube-api.ts
git commit -m "feat: add YouTube API fetcher for videos, playlists, channels"
```

---

## Phase 6: Content Management APIs

### Task 6.1: Create Add Content API

**Files:**
- Create: `server/api/parent/content/add.post.ts`

**Step 1: Create add content endpoint**

Create file `server/api/parent/content/add.post.ts`:
```typescript
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'
import { parseYouTubeUrl } from '~/server/utils/youtube'
import { fetchVideoMetadata, fetchPlaylistMetadata, fetchChannelMetadata } from '~/server/utils/youtube-api'

const addContentSchema = z.object({
  childId: z.number(),
  url: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const body = await readBody(event)
  const { childId, url } = addContentSchema.parse(body)

  // Verify child belongs to parent
  const child = await db.query.children.findFirst({
    where: and(eq(children.id, childId), eq(children.parentId, user.id!)),
  })

  if (!child) {
    throw createError({ statusCode: 404, message: 'Child not found' })
  }

  // Parse URL
  const parsed = parseYouTubeUrl(url)
  if (!parsed) {
    throw createError({ statusCode: 400, message: 'Invalid YouTube URL' })
  }

  const now = new Date()

  switch (parsed.type) {
    case 'video': {
      const metadata = await fetchVideoMetadata(parsed.id)
      const [result] = await db.insert(allowedVideos).values({
        childId,
        videoId: metadata.videoId,
        videoTitle: metadata.title,
        videoThumbnail: metadata.thumbnail,
        duration: metadata.duration,
        channelTitle: metadata.channelTitle,
        lastFetchedAt: now,
        isAvailable: true,
      }).returning()
      return { type: 'video', content: result }
    }

    case 'playlist': {
      const metadata = await fetchPlaylistMetadata(parsed.id)
      const [result] = await db.insert(allowedPlaylists).values({
        childId,
        playlistId: metadata.playlistId,
        playlistTitle: metadata.title,
        playlistThumbnail: metadata.thumbnail,
        lastFetchedAt: now,
        isAvailable: true,
      }).returning()
      return { type: 'playlist', content: result }
    }

    case 'channel': {
      const metadata = await fetchChannelMetadata(parsed.id)
      const [result] = await db.insert(allowedChannels).values({
        childId,
        channelId: metadata.channelId,
        channelTitle: metadata.title,
        channelThumbnail: metadata.thumbnail,
        lastFetchedAt: now,
        isAvailable: true,
      }).returning()
      return { type: 'channel', content: result }
    }
  }
})
```

**Step 2: Commit**

```bash
git add server/api/parent/content/add.post.ts
git commit -m "feat: add content addition API for parent"
```

---

### Task 6.2: Create Get Child Content API

**Files:**
- Create: `server/api/parent/children/[id]/content.get.ts`

**Step 1: Create get content endpoint**

Create directory and file `server/api/parent/children/[id]/content.get.ts`:
```typescript
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const childId = parseInt(getRouterParam(event, 'id') || '0')

  // Verify child belongs to parent
  const child = await db.query.children.findFirst({
    where: and(eq(children.id, childId), eq(children.parentId, user.id!)),
  })

  if (!child) {
    throw createError({ statusCode: 404, message: 'Child not found' })
  }

  const [channels, playlists, videos] = await Promise.all([
    db.query.allowedChannels.findMany({ where: eq(allowedChannels.childId, childId) }),
    db.query.allowedPlaylists.findMany({ where: eq(allowedPlaylists.childId, childId) }),
    db.query.allowedVideos.findMany({ where: eq(allowedVideos.childId, childId) }),
  ])

  return {
    child: {
      id: child.id,
      username: child.username,
      displayName: child.displayName,
    },
    channels,
    playlists,
    videos,
  }
})
```

**Step 2: Commit**

```bash
mkdir -p server/api/parent/children/\[id\]
git add server/api/parent/children/\[id\]/content.get.ts
git commit -m "feat: add get child content API"
```

---

### Task 6.3: Create Delete Content API

**Files:**
- Create: `server/api/parent/content/[id].delete.ts`

**Step 1: Create delete endpoint**

Create file `server/api/parent/content/[id].delete.ts`:
```typescript
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const contentId = parseInt(getRouterParam(event, 'id') || '0')
  const query = getQuery(event)
  const type = query.type as string

  if (!['channel', 'playlist', 'video'].includes(type)) {
    throw createError({ statusCode: 400, message: 'Invalid content type' })
  }

  // Get the content and verify ownership through child
  let content: any
  let table: any

  switch (type) {
    case 'channel':
      table = allowedChannels
      content = await db.query.allowedChannels.findFirst({ where: eq(allowedChannels.id, contentId) })
      break
    case 'playlist':
      table = allowedPlaylists
      content = await db.query.allowedPlaylists.findFirst({ where: eq(allowedPlaylists.id, contentId) })
      break
    case 'video':
      table = allowedVideos
      content = await db.query.allowedVideos.findFirst({ where: eq(allowedVideos.id, contentId) })
      break
  }

  if (!content) {
    throw createError({ statusCode: 404, message: 'Content not found' })
  }

  // Verify child belongs to parent
  const child = await db.query.children.findFirst({
    where: and(eq(children.id, content.childId), eq(children.parentId, user.id!)),
  })

  if (!child) {
    throw createError({ statusCode: 403, message: 'Not authorized to delete this content' })
  }

  await db.delete(table).where(eq(table.id, contentId))

  return { success: true }
})
```

**Step 2: Commit**

```bash
git add server/api/parent/content/\[id\].delete.ts
git commit -m "feat: add delete content API"
```

---

### Task 6.4: Create Content Management Page

**Files:**
- Create: `app/pages/parent/child/[id]/manage.vue`

**Step 1: Create manage page**

Create directories and file `app/pages/parent/child/[id]/manage.vue`:
```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const childId = parseInt(route.params.id as string)

const { data, refresh } = await useFetch(`/api/parent/children/${childId}/content`)

const activeTab = ref('channels')
const addUrl = ref('')
const addLoading = ref(false)
const addError = ref('')

async function addContent() {
  addError.value = ''
  addLoading.value = true

  try {
    await $fetch('/api/parent/content/add', {
      method: 'POST',
      body: { childId, url: addUrl.value },
    })
    addUrl.value = ''
    await refresh()
  } catch (e: any) {
    addError.value = e.data?.message || 'Failed to add content'
  } finally {
    addLoading.value = false
  }
}

async function deleteContent(id: number, type: string) {
  if (!confirm('Remove this content from allowlist?')) return

  try {
    await $fetch(`/api/parent/content/${id}?type=${type}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    alert(e.data?.message || 'Failed to delete')
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <div class="flex items-center gap-4 mb-8">
      <NuxtLink to="/parent/dashboard">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <h1 class="text-2xl font-bold">
        {{ data?.child?.displayName || data?.child?.username }}'s Content
      </h1>
    </div>

    <!-- Add Content Form -->
    <UCard class="mb-8">
      <form @submit.prevent="addContent" class="flex gap-4">
        <UInput
          v-model="addUrl"
          placeholder="Paste YouTube URL (video, playlist, or channel)"
          class="flex-1"
          required
        />
        <UButton type="submit" :loading="addLoading">
          Add
        </UButton>
      </form>
      <UAlert v-if="addError" color="red" :title="addError" class="mt-4" />
    </UCard>

    <!-- Content Tabs -->
    <UTabs :items="[
      { label: `Channels (${data?.channels?.length || 0})`, slot: 'channels' },
      { label: `Playlists (${data?.playlists?.length || 0})`, slot: 'playlists' },
      { label: `Videos (${data?.videos?.length || 0})`, slot: 'videos' },
    ]">
      <template #channels>
        <div v-if="!data?.channels?.length" class="text-center py-8 text-gray-500">
          No channels added yet
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          <UCard v-for="channel in data.channels" :key="channel.id" :class="{ 'opacity-50': !channel.isAvailable }">
            <div class="flex items-center gap-3">
              <UAvatar :src="channel.channelThumbnail" :alt="channel.channelTitle" size="lg" />
              <div class="flex-1 min-w-0">
                <p class="font-medium truncate">{{ channel.channelTitle }}</p>
                <p v-if="!channel.isAvailable" class="text-xs text-red-500">Unavailable</p>
              </div>
            </div>
            <template #footer>
              <UButton color="red" variant="ghost" size="xs" @click="deleteContent(channel.id, 'channel')">
                Remove
              </UButton>
            </template>
          </UCard>
        </div>
      </template>

      <template #playlists>
        <div v-if="!data?.playlists?.length" class="text-center py-8 text-gray-500">
          No playlists added yet
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          <UCard v-for="playlist in data.playlists" :key="playlist.id" :class="{ 'opacity-50': !playlist.isAvailable }">
            <img :src="playlist.playlistThumbnail" :alt="playlist.playlistTitle" class="w-full aspect-video object-cover rounded mb-2" />
            <p class="font-medium truncate">{{ playlist.playlistTitle }}</p>
            <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <template #footer>
              <UButton color="red" variant="ghost" size="xs" @click="deleteContent(playlist.id, 'playlist')">
                Remove
              </UButton>
            </template>
          </UCard>
        </div>
      </template>

      <template #videos>
        <div v-if="!data?.videos?.length" class="text-center py-8 text-gray-500">
          No videos added yet
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          <UCard v-for="video in data.videos" :key="video.id" :class="{ 'opacity-50': !video.isAvailable }">
            <div class="relative">
              <img :src="video.videoThumbnail" :alt="video.videoTitle" class="w-full aspect-video object-cover rounded" />
              <span v-if="video.duration" class="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <p class="font-medium truncate mt-2">{{ video.videoTitle }}</p>
            <p class="text-sm text-gray-500 truncate">{{ video.channelTitle }}</p>
            <p v-if="!video.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <template #footer>
              <UButton color="red" variant="ghost" size="xs" @click="deleteContent(video.id, 'video')">
                Remove
              </UButton>
            </template>
          </UCard>
        </div>
      </template>
    </UTabs>
  </div>
</template>
```

**Step 2: Commit**

```bash
mkdir -p app/pages/parent/child/\[id\]
git add app/pages/parent/child/\[id\]/manage.vue
git commit -m "feat: add content management page for parents"
```

---

## Phase 7: Child Browse Interface

### Task 7.1: Create Child Browse API

**Files:**
- Create: `server/api/child/browse.get.ts`

**Step 1: Create browse endpoint**

Create file `server/api/child/browse.get.ts`:
```typescript
import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['child'])

  const [channels, playlists, videos] = await Promise.all([
    db.query.allowedChannels.findMany({ where: eq(allowedChannels.childId, user.id!) }),
    db.query.allowedPlaylists.findMany({ where: eq(allowedPlaylists.childId, user.id!) }),
    db.query.allowedVideos.findMany({ where: eq(allowedVideos.childId, user.id!) }),
  ])

  return { channels, playlists, videos }
})
```

**Step 2: Commit**

```bash
git add server/api/child/browse.get.ts
git commit -m "feat: add child browse API"
```

---

### Task 7.2: Create Playlist Videos API

**Files:**
- Create: `server/api/child/playlist/[id]/videos.get.ts`

**Step 1: Create playlist videos endpoint**

Create directories and file `server/api/child/playlist/[id]/videos.get.ts`:
```typescript
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database'
import { allowedPlaylists, playlistVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'
import { fetchPlaylistVideos } from '~/server/utils/youtube-api'

const STALE_HOURS = 6

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['child'])
  const playlistDbId = parseInt(getRouterParam(event, 'id') || '0')

  // Get playlist and verify access
  const playlist = await db.query.allowedPlaylists.findFirst({
    where: and(eq(allowedPlaylists.id, playlistDbId), eq(allowedPlaylists.childId, user.id!)),
  })

  if (!playlist) {
    throw createError({ statusCode: 404, message: 'Playlist not found' })
  }

  // Check if cache is stale
  const now = new Date()
  const lastFetched = playlist.lastFetchedAt
  const isStale = !lastFetched || (now.getTime() - lastFetched.getTime()) > STALE_HOURS * 60 * 60 * 1000

  // Get cached videos
  let videos = await db.query.playlistVideos.findMany({
    where: eq(playlistVideos.playlistId, playlist.playlistId),
    orderBy: (pv, { asc }) => [asc(pv.position)],
  })

  // If stale, refresh in background (non-blocking)
  if (isStale) {
    // Fire and forget refresh
    fetchPlaylistVideos(playlist.playlistId).then(async (freshVideos) => {
      // Clear old cache
      await db.delete(playlistVideos).where(eq(playlistVideos.playlistId, playlist.playlistId))

      // Insert new cache
      if (freshVideos.length > 0) {
        await db.insert(playlistVideos).values(
          freshVideos.map((v, i) => ({
            playlistId: playlist.playlistId,
            videoId: v.videoId,
            position: i,
            videoTitle: v.title,
            videoThumbnail: v.thumbnail,
            duration: v.duration,
            channelTitle: v.channelTitle,
          }))
        )
      }

      // Update playlist last fetched
      await db.update(allowedPlaylists)
        .set({ lastFetchedAt: new Date(), isAvailable: true })
        .where(eq(allowedPlaylists.id, playlistDbId))
    }).catch(async () => {
      // Mark as unavailable if refresh fails
      await db.update(allowedPlaylists)
        .set({ isAvailable: false })
        .where(eq(allowedPlaylists.id, playlistDbId))
    })
  }

  return {
    playlist: {
      id: playlist.id,
      playlistId: playlist.playlistId,
      title: playlist.playlistTitle,
      thumbnail: playlist.playlistThumbnail,
      isAvailable: playlist.isAvailable,
    },
    videos,
  }
})
```

**Step 2: Commit**

```bash
mkdir -p server/api/child/playlist/\[id\]
git add server/api/child/playlist/\[id\]/videos.get.ts
git commit -m "feat: add playlist videos API with caching"
```

---

### Task 7.3: Create Channel Videos API

**Files:**
- Create: `server/api/child/channel/[id]/videos.get.ts`

**Step 1: Create channel videos endpoint**

Create directories and file `server/api/child/channel/[id]/videos.get.ts`:
```typescript
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database'
import { allowedChannels, channelVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'
import { fetchChannelVideos } from '~/server/utils/youtube-api'

const STALE_HOURS = 6

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['child'])
  const channelDbId = parseInt(getRouterParam(event, 'id') || '0')

  // Get channel and verify access
  const channel = await db.query.allowedChannels.findFirst({
    where: and(eq(allowedChannels.id, channelDbId), eq(allowedChannels.childId, user.id!)),
  })

  if (!channel) {
    throw createError({ statusCode: 404, message: 'Channel not found' })
  }

  // Check if cache is stale
  const now = new Date()
  const lastFetched = channel.lastFetchedAt
  const isStale = !lastFetched || (now.getTime() - lastFetched.getTime()) > STALE_HOURS * 60 * 60 * 1000

  // Get cached videos
  let videos = await db.query.channelVideos.findMany({
    where: eq(channelVideos.channelId, channel.channelId),
    orderBy: (cv, { asc }) => [asc(cv.position)],
  })

  // If stale, refresh in background
  if (isStale) {
    fetchChannelVideos(channel.channelId).then(async (freshVideos) => {
      await db.delete(channelVideos).where(eq(channelVideos.channelId, channel.channelId))

      if (freshVideos.length > 0) {
        await db.insert(channelVideos).values(
          freshVideos.map((v, i) => ({
            channelId: channel.channelId,
            videoId: v.videoId,
            position: i,
            videoTitle: v.title,
            videoThumbnail: v.thumbnail,
            duration: v.duration,
            channelTitle: v.channelTitle,
          }))
        )
      }

      await db.update(allowedChannels)
        .set({ lastFetchedAt: new Date(), isAvailable: true })
        .where(eq(allowedChannels.id, channelDbId))
    }).catch(async () => {
      await db.update(allowedChannels)
        .set({ isAvailable: false })
        .where(eq(allowedChannels.id, channelDbId))
    })
  }

  return {
    channel: {
      id: channel.id,
      channelId: channel.channelId,
      title: channel.channelTitle,
      thumbnail: channel.channelThumbnail,
      isAvailable: channel.isAvailable,
    },
    videos,
  }
})
```

**Step 2: Commit**

```bash
mkdir -p server/api/child/channel/\[id\]
git add server/api/child/channel/\[id\]/videos.get.ts
git commit -m "feat: add channel videos API with caching"
```

---

### Task 7.4: Create Child Browse Page

**Files:**
- Create: `app/pages/browse/index.vue`

**Step 1: Create browse page**

Create file `app/pages/browse/index.vue`:
```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data } = await useFetch('/api/child/browse')

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-8">My Videos</h1>

    <!-- Channels Section -->
    <section v-if="data?.channels?.length" class="mb-12">
      <h2 class="text-lg font-semibold mb-4">Channels</h2>
      <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <NuxtLink
          v-for="channel in data.channels"
          :key="channel.id"
          :to="`/browse/channel/${channel.id}`"
          class="group"
          :class="{ 'opacity-50 pointer-events-none': !channel.isAvailable }"
        >
          <div class="flex flex-col items-center text-center">
            <UAvatar
              :src="channel.channelThumbnail"
              :alt="channel.channelTitle"
              size="xl"
              class="mb-2 group-hover:ring-2 ring-primary-500 transition"
            />
            <p class="text-sm font-medium truncate w-full">{{ channel.channelTitle }}</p>
            <p v-if="!channel.isAvailable" class="text-xs text-red-500">Unavailable</p>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Playlists Section -->
    <section v-if="data?.playlists?.length" class="mb-12">
      <h2 class="text-lg font-semibold mb-4">Playlists</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <NuxtLink
          v-for="playlist in data.playlists"
          :key="playlist.id"
          :to="`/browse/playlist/${playlist.id}`"
          class="group"
          :class="{ 'opacity-50 pointer-events-none': !playlist.isAvailable }"
        >
          <div class="relative">
            <img
              :src="playlist.playlistThumbnail"
              :alt="playlist.playlistTitle"
              class="w-full aspect-video object-cover rounded-lg group-hover:ring-2 ring-primary-500 transition"
            />
            <div class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              Playlist
            </div>
          </div>
          <p class="mt-2 font-medium truncate">{{ playlist.playlistTitle }}</p>
          <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Videos Section -->
    <section v-if="data?.videos?.length" class="mb-12">
      <h2 class="text-lg font-semibold mb-4">Videos</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <NuxtLink
          v-for="video in data.videos"
          :key="video.id"
          :to="`/watch?v=${video.videoId}`"
          class="group"
          :class="{ 'opacity-50 pointer-events-none': !video.isAvailable }"
        >
          <div class="relative">
            <img
              :src="video.videoThumbnail"
              :alt="video.videoTitle"
              class="w-full aspect-video object-cover rounded-lg group-hover:ring-2 ring-primary-500 transition"
            />
            <span v-if="video.duration" class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              {{ formatDuration(video.duration) }}
            </span>
          </div>
          <p class="mt-2 font-medium line-clamp-2">{{ video.videoTitle }}</p>
          <p class="text-sm text-gray-500 truncate">{{ video.channelTitle }}</p>
          <p v-if="!video.isAvailable" class="text-xs text-red-500">Unavailable</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Empty State -->
    <div v-if="!data?.channels?.length && !data?.playlists?.length && !data?.videos?.length" class="text-center py-16">
      <UIcon name="i-heroicons-video-camera" class="w-16 h-16 mx-auto text-gray-400 mb-4" />
      <p class="text-gray-500 text-lg">No content yet!</p>
      <p class="text-gray-400">Ask your parent to add some channels, playlists, or videos.</p>
    </div>
  </div>
</template>
```

**Step 2: Commit**

```bash
mkdir -p app/pages/browse
git add app/pages/browse/index.vue
git commit -m "feat: add child browse page"
```

---

### Task 7.5: Create Playlist Detail Page

**Files:**
- Create: `app/pages/browse/playlist/[id].vue`

**Step 1: Create playlist page**

Create file `app/pages/browse/playlist/[id].vue`:
```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const playlistId = route.params.id as string

const { data } = await useFetch(`/api/child/playlist/${playlistId}/videos`)

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <div class="flex items-center gap-4 mb-8">
      <NuxtLink to="/browse">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <img
        v-if="data?.playlist?.thumbnail"
        :src="data.playlist.thumbnail"
        class="w-16 h-12 object-cover rounded"
      />
      <h1 class="text-2xl font-bold">{{ data?.playlist?.title }}</h1>
    </div>

    <div v-if="!data?.videos?.length" class="text-center py-16 text-gray-500">
      No videos in this playlist yet
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <NuxtLink
        v-for="video in data.videos"
        :key="video.id"
        :to="`/watch?v=${video.videoId}&playlist=${playlistId}`"
        class="group"
      >
        <div class="relative">
          <img
            :src="video.videoThumbnail"
            :alt="video.videoTitle"
            class="w-full aspect-video object-cover rounded-lg group-hover:ring-2 ring-primary-500 transition"
          />
          <span v-if="video.duration" class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
            {{ formatDuration(video.duration) }}
          </span>
        </div>
        <p class="mt-2 font-medium line-clamp-2">{{ video.videoTitle }}</p>
        <p class="text-sm text-gray-500 truncate">{{ video.channelTitle }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
```

**Step 2: Commit**

```bash
mkdir -p app/pages/browse/playlist
git add app/pages/browse/playlist/\[id\].vue
git commit -m "feat: add playlist detail page"
```

---

### Task 7.6: Create Channel Detail Page

**Files:**
- Create: `app/pages/browse/channel/[id].vue`

**Step 1: Create channel page**

Create file `app/pages/browse/channel/[id].vue`:
```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const channelId = route.params.id as string

const { data } = await useFetch(`/api/child/channel/${channelId}/videos`)

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <div class="flex items-center gap-4 mb-8">
      <NuxtLink to="/browse">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <UAvatar
        v-if="data?.channel?.thumbnail"
        :src="data.channel.thumbnail"
        size="lg"
      />
      <h1 class="text-2xl font-bold">{{ data?.channel?.title }}</h1>
    </div>

    <div v-if="!data?.videos?.length" class="text-center py-16 text-gray-500">
      No videos from this channel yet
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <NuxtLink
        v-for="video in data.videos"
        :key="video.id"
        :to="`/watch?v=${video.videoId}`"
        class="group"
      >
        <div class="relative">
          <img
            :src="video.videoThumbnail"
            :alt="video.videoTitle"
            class="w-full aspect-video object-cover rounded-lg group-hover:ring-2 ring-primary-500 transition"
          />
          <span v-if="video.duration" class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
            {{ formatDuration(video.duration) }}
          </span>
        </div>
        <p class="mt-2 font-medium line-clamp-2">{{ video.videoTitle }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
```

**Step 2: Commit**

```bash
mkdir -p app/pages/browse/channel
git add app/pages/browse/channel/\[id\].vue
git commit -m "feat: add channel detail page"
```

---

## Phase 8: Video Player

### Task 8.1: Create Watch Page

**Files:**
- Create: `app/pages/watch.vue`

**Step 1: Create watch page**

Create file `app/pages/watch.vue`:
```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: false })

const route = useRoute()
const videoId = route.query.v as string
const playlistParam = route.query.playlist as string | undefined

const { logout } = useAuth()

// Fetch playlist videos if playlist param present
const playlistData = playlistParam
  ? await useFetch(`/api/child/playlist/${playlistParam}/videos`)
  : { data: ref(null) }

const playbackSpeed = ref(1)
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]

const currentVideoIndex = computed(() => {
  if (!playlistData.data.value?.videos) return -1
  return playlistData.data.value.videos.findIndex((v: any) => v.videoId === videoId)
})

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// YouTube iframe API for playback speed
const player = ref<any>(null)

onMounted(() => {
  // Load YouTube iframe API
  if (!(window as any).YT) {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  }

  ;(window as any).onYouTubeIframeAPIReady = () => {
    player.value = new (window as any).YT.Player('youtube-player', {
      videoId,
      playerVars: {
        rel: 0,
        modestbranding: 1,
        autoplay: 1,
      },
      events: {
        onReady: () => {
          player.value.setPlaybackRate(playbackSpeed.value)
        },
      },
    })
  }

  // If API already loaded
  if ((window as any).YT?.Player) {
    ;(window as any).onYouTubeIframeAPIReady()
  }
})

watch(playbackSpeed, (speed) => {
  if (player.value?.setPlaybackRate) {
    player.value.setPlaybackRate(speed)
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800 px-4 py-3 flex items-center justify-between">
      <NuxtLink :to="playlistParam ? `/browse/playlist/${playlistParam}` : '/browse'" class="flex items-center gap-2 text-gray-300 hover:text-white">
        <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" />
        Back
      </NuxtLink>
      <span class="text-xl font-bold text-primary-500">ZTube</span>
      <UButton color="gray" variant="ghost" size="sm" @click="logout">
        Logout
      </UButton>
    </header>

    <div class="flex">
      <!-- Main Player Area -->
      <div :class="playlistData.data.value ? 'flex-1' : 'w-full'">
        <!-- Video Player -->
        <div class="aspect-video bg-black">
          <div id="youtube-player" class="w-full h-full"></div>
        </div>

        <!-- Controls -->
        <div class="p-4 bg-gray-800">
          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-400">Speed:</span>
            <div class="flex gap-1">
              <UButton
                v-for="speed in speeds"
                :key="speed"
                :variant="playbackSpeed === speed ? 'solid' : 'ghost'"
                :color="playbackSpeed === speed ? 'primary' : 'gray'"
                size="xs"
                @click="playbackSpeed = speed"
              >
                {{ speed }}x
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Playlist Sidebar -->
      <div v-if="playlistData.data.value?.videos" class="w-80 bg-gray-800 overflow-y-auto h-[calc(100vh-56px)]">
        <div class="p-4 border-b border-gray-700">
          <h3 class="font-semibold truncate">{{ playlistData.data.value.playlist?.title }}</h3>
          <p class="text-sm text-gray-400">{{ playlistData.data.value.videos.length }} videos</p>
        </div>
        <div class="divide-y divide-gray-700">
          <NuxtLink
            v-for="(video, index) in playlistData.data.value.videos"
            :key="video.id"
            :to="`/watch?v=${video.videoId}&playlist=${playlistParam}`"
            class="flex gap-3 p-3 hover:bg-gray-700 transition"
            :class="{ 'bg-gray-700': video.videoId === videoId }"
          >
            <span class="text-sm text-gray-400 w-6 text-center">{{ index + 1 }}</span>
            <div class="relative flex-shrink-0">
              <img :src="video.videoThumbnail" class="w-24 h-14 object-cover rounded" />
              <span v-if="video.duration" class="absolute bottom-0.5 right-0.5 bg-black/80 text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm line-clamp-2">{{ video.videoTitle }}</p>
              <p class="text-xs text-gray-400 truncate mt-1">{{ video.channelTitle }}</p>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
```

**Step 2: Commit**

```bash
git add app/pages/watch.vue
git commit -m "feat: add video player with playlist sidebar and speed controls"
```

---

## Phase 9: Admin Interface

### Task 9.1: Create Admin APIs

**Files:**
- Create: `server/api/admin/parents.get.ts`
- Create: `server/api/admin/parents/[id]/reset-password.post.ts`

**Step 1: Create get parents endpoint**

Create file `server/api/admin/parents.get.ts`:
```typescript
import { count, eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { parents, children } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireRole(event, ['superadmin'])

  const parentList = await db.query.parents.findMany()

  const parentsWithStats = await Promise.all(
    parentList.map(async (parent) => {
      const [childCount] = await db.select({ count: count() }).from(children).where(eq(children.parentId, parent.id))

      return {
        id: parent.id,
        username: parent.username,
        createdAt: parent.createdAt,
        childrenCount: childCount.count,
      }
    })
  )

  return { parents: parentsWithStats }
})
```

**Step 2: Create reset password endpoint**

Create directories and file `server/api/admin/parents/[id]/reset-password.post.ts`:
```typescript
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { parents } from '~/server/database/schema'
import { hashPassword } from '~/server/utils/password'
import { requireRole } from '~/server/utils/auth'

const resetSchema = z.object({
  newPassword: z.string().min(8),
})

export default defineEventHandler(async (event) => {
  requireRole(event, ['superadmin'])
  const parentId = parseInt(getRouterParam(event, 'id') || '0')
  const body = await readBody(event)
  const { newPassword } = resetSchema.parse(body)

  const parent = await db.query.parents.findFirst({
    where: eq(parents.id, parentId),
  })

  if (!parent) {
    throw createError({ statusCode: 404, message: 'Parent not found' })
  }

  const passwordHash = await hashPassword(newPassword)
  await db.update(parents).set({ passwordHash }).where(eq(parents.id, parentId))

  return { success: true, message: `Password reset for ${parent.username}` }
})
```

**Step 3: Commit**

```bash
mkdir -p server/api/admin/parents/\[id\]
git add server/api/admin/parents.get.ts server/api/admin/parents/\[id\]/reset-password.post.ts
git commit -m "feat: add admin APIs for parent management"
```

---

### Task 9.2: Create Admin Page

**Files:**
- Create: `app/pages/admin/index.vue`

**Step 1: Create admin page**

Create file `app/pages/admin/index.vue`:
```vue
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
```

**Step 2: Commit**

```bash
mkdir -p app/pages/admin
git add app/pages/admin/index.vue
git commit -m "feat: add admin panel page"
```

---

## Phase 10: Final Polish & Deployment

### Task 10.1: Create Cloudflare Configuration

**Files:**
- Create: `wrangler.toml`

**Step 1: Create wrangler.toml**

Create file `wrangler.toml`:
```toml
name = "ztube"
compatibility_date = "2024-01-01"

# D1 Database - update database_id after creating with `wrangler d1 create ztube-prod`
[[d1_databases]]
binding = "DB"
database_name = "ztube-prod"
database_id = "YOUR_DATABASE_ID_HERE"

[vars]
NODE_ENV = "production"
```

**Step 2: Commit**

```bash
git add wrangler.toml
git commit -m "feat: add Cloudflare wrangler configuration"
```

---

### Task 10.2: Create README

**Files:**
- Create: `README.md`

**Step 1: Create README**

Create file `README.md`:
```markdown
# ZTube

A parental control YouTube platform for curating content for children.

## Features

- Parents manage allowlists of YouTube channels, playlists, and videos
- Children browse and watch only approved content
- Clean, distraction-free video player with speed controls
- Admin panel for account management

## Local Development

1. Clone and install:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. Initialize database:
   ```bash
   npm run db:push
   ```

4. Start dev server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

## Deployment to Cloudflare

1. Create D1 database:
   ```bash
   wrangler d1 create ztube-prod
   ```

2. Update `wrangler.toml` with database_id

3. Set secrets:
   ```bash
   wrangler secret put SUPERADMIN_PASSWORD
   wrangler secret put INVITATION_CODE
   wrangler secret put YOUTUBE_API_KEY
   wrangler secret put NUXT_SESSION_PASSWORD
   ```

4. Run migrations:
   ```bash
   wrangler d1 migrations apply ztube-prod --remote
   ```

5. Deploy:
   ```bash
   npm run build
   wrangler pages deploy .output/public
   ```

## Tech Stack

- Nuxt 3 + Vue 3
- Cloudflare Pages + Workers + D1
- Drizzle ORM
- Nuxt UI + Tailwind CSS
- YouTube Data API v3
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup instructions"
```

---

### Task 10.3: Final Testing

**Step 1: Start dev server and test all flows**

Run: `npm run dev`

Test manually:
1. Visit http://localhost:3000 → should redirect to /login
2. Click Register → create parent account with invitation code
3. Create child account from dashboard
4. Add a YouTube video/channel/playlist URL
5. Login as child and verify content appears
6. Watch a video, test playback speed
7. Login as superadmin and reset a parent password

**Step 2: Run lint**

Run: `npm run lint`
Fix any errors.

**Step 3: Build for production**

Run: `npm run build`
Expected: No errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final polish and testing"
```

---

## Summary

This implementation plan covers:

1. **Phase 1**: Project scaffolding (Nuxt, Drizzle, dependencies)
2. **Phase 2**: Authentication system (login, register, sessions)
3. **Phase 3**: Core pages (login, register, index, layout)
4. **Phase 4**: Parent features (dashboard, child management)
5. **Phase 5**: YouTube API integration (URL parsing, metadata fetching)
6. **Phase 6**: Content management (add/remove allowlist items)
7. **Phase 7**: Child browse interface (grid views, detail pages)
8. **Phase 8**: Video player (YouTube embed, speed controls, playlist sidebar)
9. **Phase 9**: Admin interface (parent list, password reset)
10. **Phase 10**: Final polish and deployment config

Each task is broken into small, verifiable steps with exact commands and expected outcomes.
