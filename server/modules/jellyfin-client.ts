import { playbackReads } from '../database/playback-reads.ts'
import { database } from '../database/client.ts'
import { HTTPException } from 'hono/http-exception'
import * as schema from '../database/schema.ts'
import { unseal } from './provider-config.ts'

export type JellyfinServer = typeof schema.jellyfinServers.$inferSelect
export type JellyfinSource = {
  Id?: string; Container?: string; Path?: string; Protocol?: string; IsRemote?: boolean
  RequiresOpening?: boolean; RequiresClosing?: boolean; SupportsDirectPlay?: boolean
  MediaStreams?: { Type?: string; Codec?: string; Index?: number; Channels?: number }[]
  TranscodingUrl?: string
}
export type JellyfinItem = {
  Id: string; Name: string; Type?: string; SeriesId?: string; SeriesName?: string; ParentIndexNumber?: number
  IndexNumber?: number; RunTimeTicks?: number; Overview?: string; MediaSources?: JellyfinSource[]
}
export const jellyfinId = (id: string) => /^[a-f0-9]{32}$/i.test(id) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
export async function getJellyfinServer(env: Env, id: string, allowDisabled = false) {
  const server = await playbackReads(database(env.DB)).server().execute({ id })
  if (!server) throw new HTTPException(404, { message: 'Jellyfin server not found' })
  if (!server.enabled && !allowDisabled) throw new HTTPException(403, { message: 'This Jellyfin connection is disabled' })
  return server
}

export class JellyfinHttpError extends HTTPException {
  readonly upstreamStatus: number
  constructor(status: number) {
    super(502, { message: status === 401 || status === 403 ? 'Jellyfin rejected the API key or library permissions.' : 'Jellyfin could not serve this item. Check the server address and library.' })
    this.upstreamStatus = status
  }
}

export async function jellyfinRequest(env: Env, server: JellyfinServer, path: string, query: Record<string, string> = {}, init: RequestInit = {}) {
  const url = new URL(server.url)
  url.pathname = url.pathname.replace(/\/$/, '') + '/' + path
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const { apiKey } = await unseal<{ apiKey: string }>(env, server.id, server.credentials)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `MediaBrowser Client="ZTube", Device="ZTube", DeviceId="ztube", Version="1.0", Token="${apiKey.replace(/["\\]/g, '\\$&')}"`)
  let response: Response
  try {
    response = await fetch(url, { ...init, headers, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(30_000) })
  } catch { throw new HTTPException(502, { message: 'Could not reach Jellyfin. Check its HTTPS address and connection.' }) }
  if (!response.ok && response.status !== 416) {
    await response.body?.cancel()
    throw new JellyfinHttpError(response.status)
  }
  return response
}
export async function jellyfinJson<T>(env: Env, server: JellyfinServer, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const response = await jellyfinRequest(env, server, path, query, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try { return await response.json() as T } catch { throw new HTTPException(502, { message: 'Jellyfin returned an invalid response. Check the server address.' }) }
}
export async function jellyfinItems(env: Env, server: JellyfinServer, query: Record<string, string>) {
  const result = await jellyfinJson<{ Items?: JellyfinItem[]; TotalRecordCount?: number }>(env, server, 'Items', { enableUserData: 'false', fields: 'MediaSources,MediaStreams,Overview', ...query })
  if (!Array.isArray(result.Items) || result.Items.some(item => !item || !jellyfinId(item.Id ?? '') || typeof item.Name !== 'string')) throw new HTTPException(502, { message: 'Jellyfin returned invalid library items' })
  return { items: result.Items, total: result.TotalRecordCount ?? result.Items.length }
}
export async function jellyfinItem(env: Env, server: JellyfinServer, id: string) {
  const { items } = await jellyfinItems(env, server, { ids: id })
  if (items.length !== 1) throw new HTTPException(404, { message: 'Jellyfin item not found' })
  return items[0]
}
export function directMp4Source(sources: JellyfinSource[] = []) {
  return sources.find(source => {
    const codecs = source.MediaStreams ?? []
    const video = codecs.find(stream => stream.Type === 'Video')?.Codec?.toLowerCase()
    const audio = codecs.filter(stream => stream.Type === 'Audio')
    const mp4 = source.Container?.split(',').includes('mp4') && (!source.Path || /\.mp4$/i.test(source.Path))
    return source.Id && mp4 && (!source.Protocol || source.Protocol === 'File') && !source.IsRemote && !source.RequiresOpening && !source.RequiresClosing
      && (video === 'h264' || video === 'hevc') && audio.every(stream => ['aac', 'mp3'].includes(stream.Codec?.toLowerCase() ?? ''))
  })
}
// Import only sources that can be copied into MP4/HLS. Browser support is
// checked at playback; alternate audio tracks can make an episode compatible.
export function remuxSource(sources: JellyfinSource[] = []) {
  return sources.find(source => {
    const streams = source.MediaStreams ?? []
    const video = streams.find(stream => stream.Type === 'Video')?.Codec?.toLowerCase()
    const audio = streams.filter(stream => stream.Type === 'Audio')
    return source.Id && source.Container?.toLowerCase().split(',').some(c => ['mp4', 'mkv', 'matroska', 'webm'].includes(c))
      && (!source.Protocol || source.Protocol === 'File') && !source.IsRemote && !source.RequiresOpening && !source.RequiresClosing
      && ['h264', 'hevc'].includes(video ?? '')
      && (!audio.length || audio.some(stream => ['aac', 'mp3', 'ac3', 'eac3'].includes(stream.Codec?.toLowerCase() ?? '')))
  })
}
export function playableJellyfinSource(sources: JellyfinSource[] = []) { return directMp4Source(sources) ?? remuxSource(sources) }
export function presentJellyfinItem(serverId: string, item: JellyfinItem) {
  return { id: item.Id, name: item.Name, type: item.Type, seriesId: item.SeriesId, seriesName: item.SeriesName,
    season: item.ParentIndexNumber, episode: item.IndexNumber, duration: Math.floor((item.RunTimeTicks ?? 0) / 10_000_000),
    playable: Boolean(playableJellyfinSource(item.MediaSources)),
    playbackMode: directMp4Source(item.MediaSources) ? 'direct' : 'remux',
    imageUrl: `/api/jellyfin/${serverId}/images/${item.Id}` }
}
export async function jellyfinImage(env: Env, server: JellyfinServer, itemId: string) {
  const response = await jellyfinRequest(env, server, `Items/${itemId}/Images/Primary`, { maxWidth: '480', quality: '85', format: 'Jpg' })
  if (!/^image\/(jpeg|png|webp)\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel()
    throw new HTTPException(502, { message: 'Jellyfin image is unavailable' })
  }
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('content-type')!, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
}
export async function prepareJellyfinMedia(env: Env, server: JellyfinServer, itemId: string) {
  const info = await jellyfinJson<{ MediaSources?: JellyfinSource[] }>(env, server, `Items/${itemId}/PlaybackInfo`, {}, {
    EnableDirectPlay: true, EnableDirectStream: false, EnableTranscoding: false, AutoOpenLiveStream: false,
  })
  const source = playableJellyfinSource(info.MediaSources)
  if (!source) throw new HTTPException(415, { message: 'This episode needs H.264 or HEVC video and AAC, MP3, AC3 or EAC3 audio in MP4 or MKV. Video transcoding is disabled.' })
  return source
}

// The browser downloads the original MP4 directly from Jellyfin. Prefer an
// anonymous URL when the upstream supports it; the configured credential is
// used only as an explicit fallback for installations requiring authentication.
export async function jellyfinDirectUrl(env: Env, server: JellyfinServer, itemId: string, sourceId: string) {
  const url = new URL(server.url)
  url.pathname = url.pathname.replace(/\/$/, '') + `/Videos/${itemId}/stream.mp4`
  url.searchParams.set('Static', 'true')
  url.searchParams.set('MediaSourceId', sourceId)
  let probe: Response
  try {
    probe = await fetch(url, { redirect: 'manual', headers: { Range: 'bytes=0-31' }, signal: AbortSignal.timeout(10_000) })
  } catch { throw new HTTPException(502, { message: 'Could not reach Jellyfin for direct playback. Please try again.' }) }
  const status = probe.status
  const contentType = probe.headers.get('content-type') ?? ''
  await probe.body?.cancel()
  if ((status === 200 || status === 206) && /^(video\/mp4|application\/octet-stream)\b/i.test(contentType)) return url.href
  if (status !== 401 && status !== 403) throw new HTTPException(502, { message: 'Jellyfin did not return a direct MP4 stream. Check its public HTTPS address.' })
  const { apiKey } = await unseal<{ apiKey: string }>(env, server.id, server.credentials)
  url.searchParams.set('ApiKey', apiKey)
  return url.href
}
