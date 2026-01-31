# ZTube - Parental Control YouTube Platform Design

**Date:** 2026-01-31
**Status:** Design Complete - Ready for Implementation

## Overview

ZTube is a curated YouTube content platform that allows parents to control what their children watch by maintaining allowlists of channels, playlists, and individual videos. Children access content through a clean, distraction-free interface without recommendations, comments, or algorithmic suggestions.

**Target Users:** Small, trusted group of families (10-50 users)

## System Architecture

**Frontend:**
- Nuxt 3 with Vue 3 Composition API
- Nuxt UI component library + Tailwind CSS
- oxlint and oxfmt for linting and formatting

**Backend:**
- Nuxt server routes (API endpoints) running on Cloudflare Workers
- Server-side rendering and API handlers in single Nuxt application

**Database:**
- Cloudflare D1 (SQLite)
- Drizzle ORM for schema management and migrations
- Local SQLite file for development

**External Services:**
- YouTube Data API v3 for fetching video/channel/playlist metadata
- Free tier quota: 10,000 units/day (sufficient for target user base)

**Deployment:**
- Cloudflare Pages + Workers + D1
- Free tier hosting
- GitHub integration for continuous deployment

## User Roles & Access

### 1. Superadmin
- Environment-variable based (no database entry)
- Username: "superadmin" (fixed)
- Password: `SUPERADMIN_PASSWORD` env var
- Capabilities:
  - View all parent accounts
  - Reset parent passwords
  - Access admin panel at `/admin`

### 2. Parent
- Self-registered with invitation code
- Stored in `parents` table
- Capabilities:
  - Create and manage child accounts
  - Configure allowlists per child (channels, playlists, videos)
  - Add/remove content via YouTube URLs
  - View content availability status
  - Access dashboard at `/parent/dashboard`

### 3. Child
- Created by parent (no self-registration)
- Stored in `children` table
- Capabilities:
  - Browse allowlisted content only
  - Watch videos in embedded player
  - Navigate channels and playlists
  - Access browse view at `/browse`

## Database Schema

### Core Tables

**`parents`**
```sql
id              INTEGER PRIMARY KEY
username        TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`children`**
```sql
id              INTEGER PRIMARY KEY
parent_id       INTEGER NOT NULL REFERENCES parents(id)
username        TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
display_name    TEXT
created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`allowed_channels`**
```sql
id                  INTEGER PRIMARY KEY
child_id            INTEGER NOT NULL REFERENCES children(id)
channel_id          TEXT NOT NULL (YouTube channel ID)
channel_title       TEXT NOT NULL
channel_thumbnail   TEXT
last_fetched_at     DATETIME
is_available        BOOLEAN DEFAULT TRUE
created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`allowed_playlists`**
```sql
id                  INTEGER PRIMARY KEY
child_id            INTEGER NOT NULL REFERENCES children(id)
playlist_id         TEXT NOT NULL (YouTube playlist ID)
playlist_title      TEXT NOT NULL
playlist_thumbnail  TEXT
last_fetched_at     DATETIME
is_available        BOOLEAN DEFAULT TRUE
created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`allowed_videos`**
```sql
id                  INTEGER PRIMARY KEY
child_id            INTEGER NOT NULL REFERENCES children(id)
video_id            TEXT NOT NULL (YouTube video ID)
video_title         TEXT NOT NULL
video_thumbnail     TEXT
duration            INTEGER (seconds)
channel_title       TEXT
last_fetched_at     DATETIME
is_available        BOOLEAN DEFAULT TRUE
created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
```

### Cache Tables

**`channel_videos`**
```sql
id              INTEGER PRIMARY KEY
channel_id      TEXT NOT NULL (YouTube channel ID)
video_id        TEXT NOT NULL
position        INTEGER
video_title     TEXT NOT NULL
video_thumbnail TEXT
duration        INTEGER
channel_title   TEXT
fetched_at      DATETIME DEFAULT CURRENT_TIMESTAMP
```

**`playlist_videos`**
```sql
id              INTEGER PRIMARY KEY
playlist_id     TEXT NOT NULL (YouTube playlist ID)
video_id        TEXT NOT NULL
position        INTEGER
video_title     TEXT NOT NULL
video_thumbnail TEXT
duration        INTEGER
channel_title   TEXT
fetched_at      DATETIME DEFAULT CURRENT_TIMESTAMP
```

**Indexes:**
- `child_id` on all allowed_* tables
- `channel_id`, `playlist_id`, `video_id` on cache tables
- `username` on parents and children tables

## Authentication & Authorization

### Environment Variables

Required configuration:
- `SUPERADMIN_PASSWORD` - Password for superadmin account
- `INVITATION_CODE` - Shared secret for parent registration
- `YOUTUBE_API_KEY` - Google API key with YouTube Data API v3 enabled
- `DATABASE_URL` - D1 database binding (Cloudflare) or local SQLite path

### Login Flow

1. Single unified `/login` page for all roles
2. User enters username + password
3. Server authentication logic:
   - If `username === "superadmin"` → verify against `SUPERADMIN_PASSWORD` env var
   - Else → query `parents` table, then `children` table
4. On success, create session (JWT or encrypted cookie) containing:
   - `user_id` (null for superadmin)
   - `role` ("superadmin" | "parent" | "child")
   - `username`
5. Redirect based on role:
   - Superadmin → `/admin`
   - Parent → `/parent/dashboard`
   - Child → `/browse`

### Registration Flow

1. `/register` page with fields:
   - Invitation code (must match `INVITATION_CODE` env var)
   - Username (validated for uniqueness)
   - Password (minimum 8 characters)
2. Server validates invitation code
3. On success, creates parent account and auto-logs them in
4. Redirects to `/parent/dashboard`

### Session Management

- Use `nuxt-auth-utils` or similar for session handling
- Sessions expire after 30 days (configurable)
- Sessions stored in encrypted cookies
- No database-side session storage (stateless)

### Authorization Middleware

- Route guards check role before allowing access to protected pages
- API endpoints validate session and role
- Middleware files:
  - `/server/middleware/auth.ts` - Session validation
  - `/server/middleware/role-guard.ts` - Role-based access control

### Password Security

- Passwords hashed with bcrypt (cost factor: 10)
- Minimum 8 characters (no complexity requirements for simplicity)
- Parent/admin passwords should be strong, child passwords can be simple for memorability
- Password reset only through admin (no email-based recovery)

## YouTube API Integration

### API Quota Management

- Free quota: 10,000 units/day
- Typical costs:
  - Channel details: ~1 unit
  - Playlist items: ~1 unit
  - Video details: ~1 unit
- Expected usage for small user base: well under daily limit

### Content Fetching Strategy

**When parent adds content:**
1. Parse YouTube URL to extract ID (video/playlist/channel)
2. Validate URL format client-side
3. Call YouTube API to fetch metadata
4. Store in database with `is_available = true`, `last_fetched_at = now()`
5. Return success with content preview

**When child browses content:**
1. Query database for child's allowlisted content
2. Check `last_fetched_at` timestamp
3. If stale (> 6-12 hours):
   - Trigger background refresh (non-blocking)
   - Fetch latest metadata from YouTube API
   - Update `is_available` flag if content returns error
   - Update cached video lists for channels/playlists
4. Return cached data immediately (don't wait for refresh)

### URL Parsing

Supported formats:
- **Video:**
  - `https://youtube.com/watch?v=VIDEO_ID`
  - `https://youtu.be/VIDEO_ID`
- **Playlist:**
  - `https://youtube.com/playlist?list=PLAYLIST_ID`
- **Channel:**
  - `https://youtube.com/channel/CHANNEL_ID`
  - `https://youtube.com/@USERNAME`
  - `https://youtube.com/c/CUSTOMNAME`

### Error Handling

- **Quota exceeded:** Log error, return cached data, show admin warning
- **Content not found (404):** Mark `is_available = false`, show placeholder in child view
- **Network errors:** Retry with exponential backoff (3 attempts: 1s, 2s, 4s), fall back to cached data
- **Invalid API key:** Log critical error, prevent app startup

### API Wrapper Module

Location: `/server/utils/youtube.ts`

Functions:
- `parseYouTubeUrl(url: string)` → `{ type, id }`
- `fetchVideo(videoId: string)` → video metadata
- `fetchPlaylist(playlistId: string)` → playlist metadata + videos
- `fetchChannel(channelId: string)` → channel metadata + recent videos
- `refreshContent(type, id)` → update cached data

Centralized error handling and rate limiting logic.

## Parent Interface

### Dashboard (`/parent/dashboard`)

**Layout:**
- Header: Parent username, logout button
- Main content: Grid of child account cards
- Each card shows:
  - Child's display name/username
  - Quick stats: "X channels, Y playlists, Z videos"
  - "Manage Content" button → `/parent/child/:childId/manage`
- Footer: "Create New Child Account" button, "Change My Password" link

**Creating Child Account:**
- Modal/form with fields:
  - Username (unique validation)
  - Password (min 8 characters)
  - Display name (optional)
- Submit → creates child, returns to dashboard

### Content Management (`/parent/child/:childId/manage`)

**Layout:**
- Header: Child name, back button to dashboard
- Three tabs: "Channels", "Playlists", "Individual Videos"

**Each tab contains:**
- **Add Content Section:**
  - URL input field with placeholder: "Paste YouTube URL here"
  - "Add" button
  - Client-side URL validation
- **Content Grid/List:**
  - Cards showing:
    - Thumbnail (video/playlist/channel avatar)
    - Title
    - Status indicator:
      - Green checkmark if `is_available = true`
      - Yellow warning badge "Content Unavailable" if `is_available = false`
    - "Remove" button (trash icon)
    - "Refresh" button to manually trigger metadata update

**Adding Content Flow:**
1. Parent pastes YouTube URL
2. Client validates format
3. Submit to `/api/parent/content/add` with `child_id` and `url`
4. Server parses URL, fetches from YouTube API, saves to database
5. Show success message with content preview
6. Content appears in appropriate tab

**Removing Content:**
- Click remove button
- Confirm dialog: "Remove [content title] from [child name]'s allowlist?"
- Hard delete from database
- Update UI immediately

**Unavailable Content:**
- Displayed with dimmed appearance
- Yellow warning badge
- Parent can remove to clean up

## Child Interface

### Browse Page (`/browse`)

**Layout:**
- Clean, minimal header: Child's name, logout button
- Three main sections with visual separation:

**1. Channels Section:**
- Heading: "Channels"
- Grid of channel cards:
  - Square avatar/thumbnail
  - Channel name below
  - Hover effect
- Click → navigate to `/browse/channel/:channelId`
- Empty state: "No channels yet. Ask your parent to add some!"

**2. Playlists Section:**
- Heading: "Playlists"
- Grid of playlist cards:
  - 16:9 thumbnail
  - Playlist title
  - Video count badge
  - Hover effect
- Click → navigate to `/browse/playlist/:playlistId`
- Empty state: "No playlists yet. Ask your parent to add some!"

**3. Videos Section:**
- Heading: "Videos"
- Grid of video cards:
  - 16:9 thumbnail
  - Video title
  - Duration badge (bottom-right of thumbnail)
  - Channel name below
  - Hover effect
- Click → navigate to `/watch?v=VIDEO_ID`
- Empty state: "No videos yet. Ask your parent to add some!"

**Unavailable Content:**
- Cards with `is_available = false` shown as:
  - Grayed out / desaturated
  - "⚠️ Content Unavailable" text overlay
  - Not clickable
- Parent sees these in management interface for cleanup

### Channel Detail Page (`/browse/channel/:channelId`)

**Layout:**
- Header:
  - Back button
  - Channel avatar
  - Channel name
- Main content:
  - Grid of recent videos from channel (from `channel_videos` cache)
  - Each video card: thumbnail, title, duration, click → player
- Loading state if videos not yet cached (triggers background fetch)

### Playlist Detail Page (`/browse/playlist/:playlistId`)

**Layout:**
- Header:
  - Back button
  - Playlist thumbnail
  - Playlist title
  - Video count
- Main content:
  - Grid of videos in playlist order (from `playlist_videos` cache)
  - Each video card: thumbnail, title, duration, position number
  - Click → player with playlist context

### Player Page (`/watch?v=VIDEO_ID&playlist=PLAYLIST_ID`)

**Layout:**

**With Playlist Context (`playlist` param present):**
- Left side (70% width):
  - YouTube iframe embed
  - Playback speed controls (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)
  - Standard YouTube controls (play/pause, seek, volume, fullscreen)
- Right side (30% width):
  - Playlist sidebar:
    - Playlist title at top
    - Scrollable list of playlist videos
    - Current video highlighted
    - Click any video → loads in player, updates URL
    - Sequential auto-advance option
- Below player:
  - Video title
  - Channel name
  - Duration

**Without Playlist (standalone video or from channel):**
- Full-width player (100%)
- Video metadata below: title, channel name, duration
- Back button returns to previous browse view

**YouTube Embed Configuration:**
- No related videos at end
- No YouTube logo/watermark (if possible with API)
- No comments section
- Clean, focused watching experience

## Admin Interface

### Admin Panel (`/admin`)

**Layout:**
- Simple, functional interface (minimal styling)
- Header: "Admin Panel" title, logout button
- Main content: Table of parent accounts

**Parent Accounts Table:**
Columns:
- Username
- Created Date
- Number of Children
- Actions (Reset Password button)

**Password Reset Flow:**
1. Admin clicks "Reset Password" for a parent
2. Modal appears:
   - Parent username (read-only)
   - New password input field
   - Confirm button
3. On submit:
   - Updates parent's `password_hash` in database
   - Shows success message: "Password reset for [username]"
4. Admin manually communicates new password to parent (outside app)

**Admin Capabilities:**
- View all parent accounts
- Reset parent passwords
- No ability to create/delete parents (self-registration model)
- No content management (parent responsibility)

## API Routes & Server Structure

### Authentication Endpoints

**`POST /api/auth/login`**
- Body: `{ username, password }`
- Response: Session cookie + redirect URL
- Logic: Check superadmin env var, then query parents/children tables

**`POST /api/auth/register`**
- Body: `{ invitation_code, username, password }`
- Response: Session cookie + redirect to dashboard
- Logic: Validate invitation code, create parent account

**`POST /api/auth/logout`**
- Response: Clear session cookie, redirect to login

**`GET /api/auth/session`**
- Response: `{ user_id, role, username }`
- Used for client-side session checks

### Parent Endpoints

**`GET /api/parent/children`**
- Auth: Parent session required
- Response: Array of parent's children with stats

**`POST /api/parent/children`**
- Auth: Parent session required
- Body: `{ username, password, display_name? }`
- Response: Created child object

**`PATCH /api/parent/children/:id`**
- Auth: Parent session required, must own child
- Body: `{ password?, display_name? }`
- Response: Updated child object

**`GET /api/parent/children/:id/content`**
- Auth: Parent session required, must own child
- Response: `{ channels: [], playlists: [], videos: [] }`

**`POST /api/parent/content/add`**
- Auth: Parent session required
- Body: `{ child_id, url }`
- Response: Created content object
- Logic: Parse URL, fetch from YouTube API, save to DB

**`DELETE /api/parent/content/:id`**
- Auth: Parent session required
- Query: `?type=channel|playlist|video`
- Response: Success message
- Logic: Verify ownership, delete from appropriate table

**`POST /api/parent/content/:id/refresh`**
- Auth: Parent session required
- Query: `?type=channel|playlist|video`
- Response: Refreshed content object
- Logic: Fetch latest from YouTube API, update DB

### Child Endpoints

**`GET /api/child/browse`**
- Auth: Child session required
- Response: `{ channels: [], playlists: [], videos: [] }`
- Logic: Query child's allowlisted content, filter unavailable

**`GET /api/child/channel/:id/videos`**
- Auth: Child session required
- Response: Array of videos from channel
- Logic: Check child has access to channel, return cached videos

**`GET /api/child/playlist/:id/videos`**
- Auth: Child session required
- Response: Array of videos in playlist order
- Logic: Check child has access to playlist, return cached videos

**`GET /api/child/video/:id`**
- Auth: Child session required
- Response: Video details
- Logic: Check child has access (direct or via channel/playlist)

### Admin Endpoints

**`GET /api/admin/parents`**
- Auth: Superadmin session required
- Response: Array of all parent accounts with stats

**`POST /api/admin/parents/:id/reset-password`**
- Auth: Superadmin session required
- Body: `{ new_password }`
- Response: Success message
- Logic: Hash password, update parent record

### Server Utilities

**`/server/utils/youtube.ts`**
- YouTube API wrapper functions
- URL parsing logic
- Error handling and retries

**`/server/utils/auth.ts`**
- Session validation
- Role checking helpers
- Password hashing/verification

**`/server/utils/db.ts`**
- Drizzle client initialization
- Database connection pooling

**`/server/utils/validators.ts`**
- Input validation schemas (Zod)
- URL parsing and validation

### Server Middleware

**`/server/middleware/auth.ts`**
- Runs on all API routes
- Validates session token
- Attaches user info to request context
- Returns 401 if invalid/missing

**`/server/middleware/role-guard.ts`**
- Checks role permissions for protected routes
- Returns 403 if insufficient permissions

## Project Structure

```
ztube/
├── .env.example              # Template for local env vars
├── .env                      # Local development config (gitignored)
├── nuxt.config.ts           # Nuxt configuration
├── drizzle.config.ts        # Drizzle ORM configuration
├── wrangler.toml            # Cloudflare Workers configuration
├── package.json
├── README.md                # Setup and deployment instructions
├── app/
│   ├── components/
│   │   ├── child/
│   │   │   ├── VideoCard.vue
│   │   │   ├── ChannelCard.vue
│   │   │   ├── PlaylistCard.vue
│   │   │   └── VideoPlayer.vue
│   │   ├── parent/
│   │   │   ├── ChildCard.vue
│   │   │   ├── ContentGrid.vue
│   │   │   ├── AddContentForm.vue
│   │   │   └── ContentCard.vue
│   │   ├── admin/
│   │   │   └── ParentTable.vue
│   │   └── shared/
│   │       ├── Header.vue
│   │       ├── EmptyState.vue
│   │       └── LoadingSpinner.vue
│   ├── pages/
│   │   ├── index.vue                    # Redirect to login
│   │   ├── login.vue                    # Unified login
│   │   ├── register.vue                 # Parent registration
│   │   ├── admin/
│   │   │   └── index.vue                # Admin panel
│   │   ├── parent/
│   │   │   ├── dashboard.vue            # Parent dashboard
│   │   │   └── child/
│   │   │       └── [id]/
│   │   │           └── manage.vue       # Content management
│   │   ├── browse/
│   │   │   ├── index.vue                # Child browse view
│   │   │   ├── channel/
│   │   │   │   └── [id].vue             # Channel detail
│   │   │   └── playlist/
│   │   │       └── [id].vue             # Playlist detail
│   │   └── watch.vue                    # Video player
│   ├── layouts/
│   │   ├── default.vue
│   │   ├── child.vue
│   │   └── admin.vue
│   ├── composables/
│   │   ├── useAuth.ts                   # Auth state management
│   │   ├── useContent.ts                # Content fetching
│   │   └── useYouTube.ts                # YouTube player helpers
│   └── app.vue
├── server/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login.post.ts
│   │   │   ├── register.post.ts
│   │   │   ├── logout.post.ts
│   │   │   └── session.get.ts
│   │   ├── parent/
│   │   │   ├── children.get.ts
│   │   │   ├── children.post.ts
│   │   │   ├── children/[id].patch.ts
│   │   │   ├── children/[id]/content.get.ts
│   │   │   ├── content/add.post.ts
│   │   │   ├── content/[id].delete.ts
│   │   │   └── content/[id]/refresh.post.ts
│   │   ├── child/
│   │   │   ├── browse.get.ts
│   │   │   ├── channel/[id]/videos.get.ts
│   │   │   ├── playlist/[id]/videos.get.ts
│   │   │   └── video/[id].get.ts
│   │   └── admin/
│   │       ├── parents.get.ts
│   │       └── parents/[id]/reset-password.post.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── role-guard.ts
│   ├── utils/
│   │   ├── youtube.ts
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   └── validators.ts
│   └── database/
│       ├── schema.ts                    # Drizzle schema
│       └── migrations/                  # Generated SQL migrations
├── public/
│   ├── favicon.ico
│   └── logo.svg
└── docs/
    └── plans/
        └── 2026-01-31-ztube-parental-control-design.md
```

## Development Setup

### Prerequisites

- Node.js 20+ (LTS)
- npm or pnpm
- Git
- YouTube Data API v3 key (free, from Google Cloud Console)

### Initial Setup

1. **Clone and install:**
   ```bash
   git clone <repo-url> ztube
   cd ztube
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   SUPERADMIN_PASSWORD=your-secure-password
   INVITATION_CODE=your-secret-code
   YOUTUBE_API_KEY=your-youtube-api-key
   DATABASE_URL=./.dev.db
   ```

3. **Initialize database:**
   ```bash
   npm run db:push
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

5. **Access application:**
   - Open `http://localhost:3000`
   - Login as superadmin or register as parent

### Package Dependencies

**Core:**
- `nuxt` (3.x) - Framework
- `vue` (3.x) - UI framework
- `@nuxt/ui` - Component library
- `drizzle-orm` - ORM
- `drizzle-kit` - Migration tooling

**Database:**
- `better-sqlite3` - Local SQLite driver (dev)
- `@cloudflare/workers-types` - D1 types (prod)

**Authentication:**
- `nuxt-auth-utils` or `h3-session` - Session management
- `bcrypt` - Password hashing

**Validation:**
- `zod` - Schema validation

**Development:**
- `oxlint` - Linting
- `oxfmt` - Formatting
- `wrangler` - Cloudflare CLI

### Scripts

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "preview": "nuxt preview",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:studio": "drizzle-kit studio",
    "lint": "oxlint",
    "format": "oxfmt",
    "deploy": "wrangler pages deploy .output/public"
  }
}
```

## Deployment to Cloudflare

### Prerequisites

1. Cloudflare account (free tier)
2. Wrangler CLI: `npm install -g wrangler`
3. Authenticated: `wrangler login`

### Setup D1 Database

```bash
# Create production database
wrangler d1 create ztube-prod

# Note the database_id from output
# Example: database_id = "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6"
```

### Configure wrangler.toml

Create `wrangler.toml`:
```toml
name = "ztube"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "ztube-prod"
database_id = "your-database-id-here"

[vars]
NODE_ENV = "production"
```

### Configure Secrets

```bash
wrangler secret put SUPERADMIN_PASSWORD
# Enter: your-secure-admin-password

wrangler secret put INVITATION_CODE
# Enter: your-invitation-secret

wrangler secret put YOUTUBE_API_KEY
# Enter: your-youtube-api-key
```

### Run Migrations

```bash
# Generate migration from schema
npm run db:generate

# Apply to remote D1 database
wrangler d1 migrations apply ztube-prod --remote
```

### Nuxt Configuration for Cloudflare

Update `nuxt.config.ts`:
```typescript
export default defineNuxtConfig({
  nitro: {
    preset: 'cloudflare-pages'
  },
  runtimeConfig: {
    superadminPassword: '',
    invitationCode: '',
    youtubeApiKey: '',
  }
})
```

### Deploy Options

**Option 1: Wrangler CLI**
```bash
npm run build
wrangler pages deploy .output/public
```

**Option 2: GitHub Integration (Recommended)**
1. Push code to GitHub repository
2. Go to Cloudflare Dashboard → Pages → Create Project
3. Connect GitHub repository
4. Configure build settings:
   - Build command: `npm run build`
   - Build output directory: `.output/public`
   - Root directory: `/`
5. Add environment variables in Cloudflare Pages settings:
   - `SUPERADMIN_PASSWORD`
   - `INVITATION_CODE`
   - `YOUTUBE_API_KEY`
6. Deploy
7. Future commits to main branch auto-deploy

### Post-Deployment

1. Access app at `your-project.pages.dev`
2. Test login as superadmin
3. Register first parent account with invitation code
4. Optional: Add custom domain in Cloudflare Pages settings
5. Monitor usage in Cloudflare dashboard:
   - D1 database storage
   - Pages requests
   - Worker CPU time
   - YouTube API quota (Google Cloud Console)

## Error Handling & Edge Cases

### YouTube API Failures

**Quota Exceeded:**
- Return cached data to users
- Log warning with timestamp
- Optional: Notify admin (future enhancement)
- Display message in admin panel: "YouTube API quota exceeded - using cached data"

**Network Timeout:**
- Retry 3 times with exponential backoff (1s, 2s, 4s)
- If all retries fail, use cached data
- Log error for monitoring

**Content Not Found (404):**
- Return user-friendly error: "Content not found on YouTube"
- Do not save to database
- Suggest parent check URL

**Invalid API Key:**
- Log critical error on app startup
- Prevent server from starting
- Display clear error message: "Invalid YouTube API key. Check YOUTUBE_API_KEY environment variable."

### Content Staleness

**Content >24 hours stale + refresh fails:**
- Still show cached version
- Small indicator: "May be outdated" (optional)
- Log refresh failure for admin review

**Content never successfully fetched:**
- Show error state: "Unable to load content"
- Provide "Retry" button for manual refresh

### Session Handling

**Expired Session:**
- Redirect to login with message: "Session expired. Please log in again."
- Preserve intended destination for redirect after login

**Invalid Session Token:**
- Clear session cookie
- Redirect to login
- Log potential security issue (corrupted/tampered token)

**Concurrent Logins:**
- Allow multiple sessions (no single-session enforcement)
- Simple implementation, sufficient for trusted user base

### Database Errors

**Connection Failure:**
- Return HTTP 500
- Log error with stack trace
- Show user: "Service temporarily unavailable. Please try again later."

**Constraint Violations:**
- Duplicate username: Return HTTP 400 with message "Username already exists"
- Foreign key violations: Return HTTP 400 with message "Invalid reference"
- Log error for debugging

**Migration Failures:**
- Fail deployment
- Require manual intervention
- Do not allow app to start with mismatched schema

### User Input Validation

**Invalid YouTube URLs:**
- Client-side validation before API call
- Show error: "Invalid YouTube URL. Please paste a valid video, playlist, or channel link."
- Supported formats displayed as hint

**Weak Passwords:**
- Block registration/password change if <8 characters
- Clear error: "Password must be at least 8 characters"
- No complexity requirements (keeping it simple for family use)

**XSS Protection:**
- All user inputs sanitized by Nuxt/Vue (default behavior)
- Content Security Policy headers in production
- Escape all dynamic content in templates

**SQL Injection:**
- Drizzle ORM parameterizes all queries (protected by default)
- No raw SQL queries unless absolutely necessary
- If raw SQL needed, use parameterized queries only

### Edge Cases

**Child with zero allowlisted content:**
- Show friendly empty state: "No content yet! Ask your parent to add some channels, playlists, or videos."
- Provide visual illustration or icon

**Parent with zero children:**
- Show prompt: "Create your first child account to get started"
- Large "Create Child Account" button prominently displayed

**Deleted YouTube Channel:**
- Mark `is_available = false` on next fetch
- Show placeholder in child view: "⚠️ Channel No Longer Available"
- Parent sees in management interface for cleanup

**Private/Unlisted Content:**
- YouTube API returns error
- Mark `is_available = false`
- Show placeholder with appropriate message
- Parent can remove if no longer needed

**Very Long Playlist (500+ videos):**
- Cache most recent 100 videos only
- Paginate in child UI (show "Load More" button)
- Performance optimization for large playlists
- Consider lazy loading on scroll (future enhancement)

**Playlist Dynamically Updated by Parent:**
- Next refresh (within 6-12 hours) picks up new videos
- Child sees updated content automatically
- No manual refresh needed by parent (unless they want immediate update)

**Channel Uploads New Video:**
- Detected on next refresh cycle
- Appears in child's channel view automatically
- Staleness check ensures content stays current

## Future Enhancements

These features are explicitly deferred for initial release but documented for future consideration:

1. **Time Controls:**
   - Daily watch time limits per child
   - Scheduled viewing windows (e.g., "Only after 3 PM on weekdays")
   - Requires background job for time tracking

2. **Watch History:**
   - Track what children watch and when
   - Parent can review watch history
   - Analytics: most-watched content, viewing patterns

3. **Content Categories/Tags:**
   - Parent assigns tags when adding content (e.g., "Math", "Science", "Stories")
   - Child can filter by category
   - Better organization for large content libraries

4. **Bulk Content Management:**
   - Import/export allowlists (JSON/CSV)
   - Copy allowlist from one child to another
   - Bulk remove content

5. **Search Within Allowlist:**
   - Child can search their available content
   - Filter by channel, duration, keywords
   - Useful as content library grows

6. **Email Notifications (Optional):**
   - Notify parent when child reaches time limit
   - Weekly summary of watch activity
   - Requires email configuration (SendGrid, Resend, etc.)

7. **Multiple Admin Accounts:**
   - Database-backed admin accounts instead of env var
   - Admin can create other admins
   - More suitable if user base grows

8. **Shared Family Allowlists:**
   - Default allowlist that all children inherit
   - Per-child additions on top of family list
   - Reduces duplicate content management

9. **Offline Mode:**
   - Service worker for PWA
   - Cache video metadata and thumbnails
   - Allows browsing (not watching) offline

10. **Advanced Player Features:**
    - Playback progress tracking
    - Resume where left off
    - Keyboard shortcuts
    - Picture-in-picture mode

## Success Criteria

The implementation will be considered successful when:

1. ✅ Superadmin can log in and reset parent passwords
2. ✅ Parents can self-register with invitation code
3. ✅ Parents can create child accounts
4. ✅ Parents can add YouTube channels, playlists, and videos by pasting URLs
5. ✅ Parents can remove content from child allowlists
6. ✅ Children can log in and see their allowlisted content
7. ✅ Children can browse channels and playlists
8. ✅ Children can watch videos in embedded player with speed controls
9. ✅ Playlist videos show in sidebar when watching from playlist
10. ✅ Content unavailability is handled gracefully (placeholder shown)
11. ✅ App deploys successfully to Cloudflare Pages + D1
12. ✅ Local development works with SQLite file
13. ✅ All API endpoints protected with appropriate auth/authorization
14. ✅ UI is clean, fast, and responsive on desktop and tablet
15. ✅ YouTube API quota stays well under free tier limits

## Risk Assessment

**Low Risk:**
- Cloudflare free tier limits (very generous for target user base)
- YouTube API quota (10,000 units/day sufficient)
- Database size (D1 free tier: 5GB, ample for hundreds of users)

**Medium Risk:**
- YouTube API changes (mitigation: wrapper module makes updates easier)
- Content availability checks (stale cache strategy reduces impact)
- URL parsing edge cases (comprehensive testing needed)

**Mitigation Strategies:**
- Graceful degradation when API fails (use cached data)
- Error logging and monitoring (Cloudflare logs)
- Clear error messages to users
- Admin panel shows system health indicators

## Conclusion

This design provides a complete blueprint for ZTube, a parental control platform for YouTube content. The architecture is simple, leveraging Nuxt 3's full-stack capabilities and Cloudflare's free tier infrastructure. The three-tier user model (superadmin, parent, child) ensures appropriate access control while keeping the system easy to use and maintain.

Key design decisions:
- **Simplicity first:** No email, minimal admin, allowlist-only approach
- **Free hosting:** Cloudflare Pages + Workers + D1
- **Modern stack:** Nuxt 3, Vue 3, Drizzle ORM, Tailwind CSS
- **Cached data:** Lazy refresh strategy minimizes API usage
- **Clean UX:** Distraction-free YouTube consumption for children

The system is designed to scale to 50-100 families while staying within free tier limits of all services. Future enhancements like time controls and watch history can be added incrementally without major architectural changes.

---

**Ready for Implementation:** This design is complete and ready to be translated into an implementation plan with specific tasks, file creation, and code scaffolding.
