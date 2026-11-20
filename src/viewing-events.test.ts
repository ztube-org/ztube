import assert from 'node:assert/strict'
import test from 'node:test'
import { groupViewingEvents, viewingDayLabel, type PlaybackViewingEvent, type ViewingEvent } from './viewing-events.ts'

const epoch = (time: string) => Date.parse(time) / 1000
const timeZone = 'America/Los_Angeles'
const video = { videoId: 'jf:episode', videoTitle: 'First episode', channelTitle: 'Adventure cartoons' }

function session(sessionId: string, startedAt: string, watchedSeconds: number, timePoolName: string | null): PlaybackViewingEvent {
  return {
    kind: 'playback', ...video, sessionId, startedAt: epoch(startedAt), lastWatchedAt: epoch(startedAt) + watchedSeconds,
    watchedSeconds, usageBucket: 'cartoon', timePoolId: null, timePoolName, status: 'ended',
  }
}

test('groups repeat sessions and unlocks by video and by the first counted instant in each local day', () => {
  const early = session('earlier', '2026-11-19T07:59:40Z', 40, 'Cartoons')
  const first = session('first', '2026-11-19T08:00:00Z', 68, null)
  const second = session('second', '2026-11-19T10:00:00Z', 80, 'Cartoons')
  const third = session('third', '2026-11-19T11:00:00Z', 23, 'Cartoons')
  const events: ViewingEvent[] = [
    first, early,
    { kind: 'unlock', ...video, unlockedAt: epoch('2026-11-19T09:00:00Z') },
    { kind: 'unlock', videoId: 'jf:removed', videoTitle: 'jf:removed', channelTitle: null, unlockedAt: epoch('2026-11-19T09:10:00Z') },
    second, third,
  ]
  const days = groupViewingEvents(events, timeZone)
  assert.deepEqual(days.map(day => [day.day, day.watchedSeconds, day.watchedVideoCount, day.unlockCount]), [
    ['2026-11-19', 171, 1, 2],
    ['2026-11-18', 40, 1, 0],
  ])
  assert.deepEqual(days[0]!.videos.map(group => [group.title, group.subtitle]), [
    ['First episode', 'Adventure cartoons'],
    ['Unavailable video', null],
  ])
  const merged = days[0]!.videos[0]!
  assert.deepEqual(merged.sessions.map(item => item.sessionId), ['third', 'second', 'first'])
  assert.deepEqual(merged.timePools, ['Cartoons', 'Cartoon Time'])
  assert.equal(merged.unlocks.length, 1)
  assert.deepEqual(groupViewingEvents([], timeZone), [])
})

test('day labels use the Child’s local calendar even when the UTC date has rolled over', () => {
  const now = new Date('2026-11-19T07:30:00Z')
  assert.equal(viewingDayLabel('2026-11-18', timeZone, now), 'Today · Wed, Nov 18')
  assert.equal(viewingDayLabel('2026-11-17', timeZone, now), 'Yesterday · Tue, Nov 17')
  assert.equal(viewingDayLabel('2026-11-16', timeZone, now), 'Mon, Nov 16')
})
