export type ContentRule = 'restricted' | 'exempt'
export type ApprovedSourceKind = 'channel' | 'playlist'

export type UsageBucketStatus = { remainingSeconds: number; locked: boolean }
export type WatchTimeStatus = { restricted: UsageBucketStatus; exempt: UsageBucketStatus }

export type ApprovedVideo = {
  videoId: string
  videoTitle: string
  videoThumbnail: string | null
  duration: number | null
  channelTitle: string | null
  publishedAt: string | null
  contentRule: ContentRule
}

export type SourceSummary = {
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
  nextPage: number | null
  watchTime: WatchTimeStatus
  policy: { blocked: boolean }
}
