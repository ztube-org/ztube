export type ContentRule = 'restricted' | 'exempt'
export type UsageBucket = ContentRule | 'cartoon'
export type ApprovedSourceKind = 'channel' | 'playlist'

export type UsageBucketStatus = { remainingSeconds: number; locked: boolean }
export type TimePool = { id: string; name: string; weekdayMinutes: number; weekendMinutes: number; requiresClaim: boolean; legacyKey: UsageBucket | null }
export type TimePoolStatus = TimePool & UsageBucketStatus & { usedSeconds: number; allowanceMinutes: number; extensionMinutes: number; unlocked: boolean }
export type TimePoolBinding = { kind: 'channel' | 'playlist' | 'video' | 'cartoon'; contentId: string; poolId: string }
export type TimePoolsResponse = { pools: TimePoolStatus[]; bindings: TimePoolBinding[]; viewingDay: string }
export type WatchTimeStatus = { restricted: UsageBucketStatus; exempt: UsageBucketStatus; cartoon?: UsageBucketStatus; pools?: TimePoolStatus[] }

export type ApprovedVideo = {
  timePoolId?: string | null
  timePoolName?: string | null
  timePoolConflict?: boolean
  requiresClaim?: boolean
  usageBucket?: UsageBucket
  season?: string | null
  position?: number | null
  videoId: string
  videoTitle: string
  videoThumbnail: string | null
  duration: number | null
  channelTitle: string | null
  publishedAt: string | null
  contentRule: ContentRule
  isAvailable?: boolean
  positionSeconds?: number
  tags?: string[]
}

export type SourceSummary = {
  curated?: boolean
  id: number
  title: string
  thumbnail: string | null
  isAvailable: boolean
  contentRule: ContentRule
  tags: string[]
}

export type SourceVideosResponse = {
  channel?: SourceSummary
  playlist?: SourceSummary
  videos: ApprovedVideo[]
  favoriteVideoIds: string[]
  unlockedVideoIds?: string[]
  nextPage: number | null
  watchTime: WatchTimeStatus
  policy: ViewingPolicy
}

export type ViewingPolicy = {
  blocked: boolean
  reason?: 'viewing-pause' | 'outside-window' | 'required-break' | null
  breakUntil?: string | null
  nextWindow?: { day: string; time: string; timeZone: string } | null
}
export type ViewingStatus = { watchTime: WatchTimeStatus; policy: ViewingPolicy }
export type BrowseChannel = { id: number; channelTitle: string; channelThumbnail: string | null; isAvailable: boolean; contentRule: ContentRule; tags: string[] }
export type BrowsePlaylist = { id: number; playlistId?: string; cartoonPool?: boolean; playlistTitle: string; playlistThumbnail: string | null; isAvailable: boolean; contentRule: ContentRule; tags: string[] }
export type SeriesNavigation = { playlistId: number; seriesTitle: string; previousVideoId: string; previousTitle: string; nextVideoId: string | null; nextTitle: string | null }
export type BrowseResponse = ViewingStatus & {
  seriesNavigation?: SeriesNavigation[]
  channels: BrowseChannel[]
  playlists: BrowsePlaylist[]
  videos: ApprovedVideo[]
  recommendations: ApprovedVideo[]
  favorites: ApprovedVideo[]
  continueWatching: ApprovedVideo[]
  favoriteVideoIds: string[]
  recommendationCount: number
}

export type EpisodeClaimStatus = {
  viewingDay: string
  dailyLimit: number
  bonusCredits?: number
  totalCredits?: number
  remaining: number
  unlockedVideoIds?: string[]
  claimedVideoIds: string[]
}

export type EpisodeClaimPrompt = EpisodeClaimStatus & { videoTitle: string; positionSeconds?: number; duration?: number | null }

export type CartoonPoolResponse = EpisodeClaimStatus & {
  timePools?: TimePoolStatus[]
  cartoonTime: UsageBucketStatus & { usedSeconds: number; allowanceMinutes: number }
  videos: ApprovedVideo[]
  unlockedVideos?: ApprovedVideo[]
  claimedVideos: ApprovedVideo[]
  nextPage: number | null
}
