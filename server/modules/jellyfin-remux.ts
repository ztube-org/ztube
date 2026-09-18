import { HTTPException } from 'hono/http-exception'
import { getJellyfinServer, JellyfinHttpError, jellyfinId, jellyfinJson, jellyfinRequest, type JellyfinServer, type JellyfinSource } from './jellyfin-client.ts'
import { unseal } from './provider-config.ts'

export type RemuxSession = { id: string; serverId: string; playSessionId: string; deviceId: string }
const unsupported = () => new HTTPException(415, { message: 'This browser cannot play this episode’s video or supported audio output. Video transcoding is disabled. Try Safari on an Apple device, or use a compatible H.264/AAC version.' })

// No manifests or media bytes are fetched here. Jellyfin owns the container
// conversion and optional AAC audio encoding. Video is always copied.
export async function prepareJellyfinRemux(env: Env, server: JellyfinServer, itemId: string, source: JellyfinSource, codecs: string[], deviceId: string, nativePlayback?: { codecs: string[]; preferred: boolean }) {
  const streams = source.MediaStreams ?? []
  const video = streams.find(s => s.Type === 'Video')?.Codec?.toLowerCase()
  const audioStreams = streams.filter(s => s.Type === 'Audio')
  const mse = { engine: 'mse' as const, codecs }
  const native = { engine: 'native' as const, codecs: nativePlayback?.codecs ?? [] }
  const candidatesByEngine = nativePlayback?.preferred ? [native, mse] : [mse, native]
  const selected = candidatesByEngine.flatMap(candidate => {
    if (!video || !['h264', 'hevc'].includes(video) || !candidate.codecs.includes(video)) return []
    const audio = audioStreams.find(s => candidate.codecs.includes(s.Codec?.toLowerCase() ?? '') && ['aac', 'mp3', 'ac3', 'eac3'].includes(s.Codec?.toLowerCase() ?? ''))
    if ((audioStreams.length && !audio) || (audioStreams.length > 1 && audio?.Index === undefined)) return []
    return [{ engine: candidate.engine, audio, convertAudio: false }]
  })[0] ?? candidatesByEngine.flatMap(candidate => {
    // Try every original-audio path before converting audio on Jellyfin.
    // Both video and AAC must work within this same playback engine.
    if (!video || !['h264', 'hevc'].includes(video) || !candidate.codecs.includes(video) || !candidate.codecs.includes('aac')) return []
    const audio = audioStreams.find(s => ['aac', 'mp3', 'ac3', 'eac3'].includes(s.Codec?.toLowerCase() ?? '') && (audioStreams.length === 1 || s.Index !== undefined))
    return audio ? [{ engine: candidate.engine, audio, convertAudio: true }] : []
  })[0]
  if (!selected) throw unsupported()
  const { audio, convertAudio } = selected
  const audioCodec = convertAudio ? 'aac' : audio?.Codec?.toLowerCase()
  const users = await jellyfinJson<{ Id: string; Policy?: { IsDisabled?: boolean; IsAdministrator?: boolean } }[]>(env, server, 'Users')
  const enabled = users.filter(u => jellyfinId(u.Id) && !u.Policy?.IsDisabled)
    .sort((a, b) => Number(Boolean(a.Policy?.IsAdministrator)) - Number(Boolean(b.Policy?.IsAdministrator)) || a.Id.localeCompare(b.Id))
  const candidates = server.userId ? enabled.filter(u => u.Id === server.userId) : enabled.slice(0, 10)
  let info: { MediaSources?: JellyfinSource[]; PlaySessionId?: string } | undefined
  for (const user of candidates) {
    try {
      info = await jellyfinJson(env, server, `Items/${itemId}/PlaybackInfo`, { deviceId }, {
        UserId: user.Id, MediaSourceId: source.Id, MaxStreamingBitrate: 120_000_000,
        DeviceProfile: {
          Name: 'ZTube video copy', MaxStreamingBitrate: 120_000_000,
          DirectPlayProfiles: [],
          TranscodingProfiles: [{ Type: 'Video', Container: 'mp4', Protocol: 'hls', VideoCodec: video, AudioCodec: audioCodec ?? 'aac', Context: 'Streaming', MaxAudioChannels: convertAudio ? '2' : String(audio?.Channels ?? 8), MinSegments: 1, SegmentLength: 6 }],
          SubtitleProfiles: [], CodecProfiles: [], ContainerProfiles: [],
        },
        EnableDirectPlay: false, EnableDirectStream: true, EnableTranscoding: convertAudio,
        AllowVideoStreamCopy: true, AllowAudioStreamCopy: !convertAudio, AutoOpenLiveStream: false,
        SubtitleStreamIndex: -1, ...(audio?.Index === undefined ? {} : { AudioStreamIndex: audio.Index }),
      })
      break
    } catch (error) {
      // Enumeration with an API key can include items this user cannot play.
      // Only a 404 during automatic selection permits trying another user.
      if (!server.userId && error instanceof JellyfinHttpError && error.upstreamStatus === 404) continue
      if (error instanceof JellyfinHttpError && error.upstreamStatus === 404) throw new HTTPException(502, { message: 'The selected Jellyfin playback user cannot access this episode. Choose another user in connection settings.' })
      throw error
    }
  }
  if (!info) throw new HTTPException(502, { message: 'Choose an enabled Jellyfin playback user with access to this episode in the connection settings.' })
  if (!info.PlaySessionId || !jellyfinId(info.PlaySessionId)) throw new HTTPException(502, { message: 'Jellyfin did not provide a Remux session.' })
  const session = { serverId: server.id, playSessionId: info.PlaySessionId, deviceId }
  try {
    const result = info.MediaSources?.find(s => s.Id === source.Id)
    if (!result?.TranscodingUrl) throw new HTTPException(415, { message: convertAudio ? 'Jellyfin cannot convert this episode’s audio to AAC. Check the selected playback user’s audio transcoding permission.' : 'Jellyfin cannot remux this episode. Check the selected playback user’s streaming permissions.' })
    const base = new URL(server.url)
    let url: URL
    try { url = new URL(result.TranscodingUrl, base) }
    catch { throw new HTTPException(502, { message: 'Jellyfin returned an invalid Remux address.' }) }
    const prefix = base.pathname.replace(/\/$/, '')
    // A negotiation response must never redirect credentials to another host,
    // another item, or a progressive endpoint with unreliable seeking.
    const expectedPaths = [itemId.replaceAll('-', ''), itemId.replaceAll('-', '').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')]
      .map(id => `${prefix}/Videos/${id}/master.m3u8`.toLowerCase())
    if (url.origin !== base.origin || url.username || url.password || !expectedPaths.includes(url.pathname.toLowerCase())) throw new HTTPException(502, { message: 'Jellyfin returned an unexpected Remux address.' })
    // Rebuild from an allowlist, ignoring encoder/filter/subtitle options that
    // an upstream profile might have included in its TranscodingUrl.
    url.search = ''
    const { apiKey } = await unseal<{ apiKey: string }>(env, server.id, server.credentials)
    const params = {
      ApiKey: apiKey, MediaSourceId: source.Id!, PlaySessionId: info.PlaySessionId, DeviceId: deviceId,
      VideoCodec: 'copy', AudioCodec: convertAudio ? 'aac' : 'copy', AllowVideoStreamCopy: 'true', AllowAudioStreamCopy: String(!convertAudio),
      SubtitleStreamIndex: '-1', SegmentContainer: 'mp4', MinSegments: '1', SegmentLength: '6',
      ...(convertAudio ? { AudioBitrate: '192000', TranscodingMaxAudioChannels: '2' } : {}),
      ...(audio?.Index === undefined ? {} : { AudioStreamIndex: String(audio.Index) }),
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return { url: url.href, transport: 'hls' as const, hlsEngine: selected.engine, ...session }
  } catch (error) {
    try { await stopJellyfinRemux(env, server, session) } catch { /* No media was requested; do not hide the negotiation error. */ }
    throw error
  }
}

export async function stopJellyfinRemux(env: Env, server: JellyfinServer, session: Pick<RemuxSession, 'deviceId' | 'playSessionId'>) {
  const response = await jellyfinRequest(env, server, 'Videos/ActiveEncodings', { deviceId: session.deviceId, playSessionId: session.playSessionId }, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
  await response.body?.cancel()
}

export async function cleanupRemux(env: Env, session: RemuxSession) {
  try {
    const server = await getJellyfinServer(env, session.serverId, true)
    await stopJellyfinRemux(env, server, session)
    await env.DB.prepare('DELETE FROM jellyfin_remux_sessions WHERE id = ?').bind(session.id).run()
  } catch {
    // Preserve the row for the scheduled retry. Never log upstream errors/URLs.
    console.warn(JSON.stringify({ event: 'jellyfin_remux_cleanup_retry', id: session.id }))
  }
}

export async function cleanupExpiredRemux(env: Env, instant = new Date()) {
  const rows = await env.DB.prepare(`SELECT r.id, r.server_id AS serverId, r.play_session_id AS playSessionId, r.device_id AS deviceId
    FROM jellyfin_remux_sessions r JOIN playback_sessions p ON p.id = r.authorization_id
    JOIN jellyfin_servers s ON s.id = r.server_id
    WHERE p.ended_at IS NOT NULL OR p.lease_expires_at <= ? OR s.enabled = 0
    ORDER BY r.created_at LIMIT 20`).bind(Math.floor(instant.getTime() / 1000)).all<RemuxSession>()
  for (const row of rows.results) await cleanupRemux(env, row)
}
