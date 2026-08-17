import assert from 'node:assert/strict'
import test from 'node:test'
import { playbackPolicyAt } from './playback-policy.ts'

const settings = {
  timeZone: 'America/Los_Angeles',
  allowedStartMinute: 7 * 60,
  allowedEndMinute: 20 * 60,
  breakAfterMinutes: 30,
  breakDurationMinutes: 15,
}

test('blocks playback outside the Child Viewing Window', () => {
  assert.equal(playbackPolicyAt(new Date('2026-08-17T13:59:00Z'), settings, {}).reason, 'outside-window')
  assert.equal(playbackPolicyAt(new Date('2026-08-17T14:00:00Z'), settings, {}).reason, null)
  assert.equal(playbackPolicyAt(new Date('2026-08-18T03:00:00Z'), settings, {}).reason, 'outside-window')
})

test('Viewing Pause and an active Required Break override an open window', () => {
  const instant = new Date('2026-08-17T18:00:00Z')
  assert.equal(playbackPolicyAt(instant, settings, { playbackPaused: true }).reason, 'viewing-pause')
  assert.equal(playbackPolicyAt(instant, settings, { breakUntil: new Date('2026-08-17T18:05:00Z') }).reason, 'required-break')
  assert.equal(playbackPolicyAt(instant, settings, { breakUntil: new Date('2026-08-17T17:59:00Z') }).reason, null)
})

test('reports the remaining Break Cycle without mixing it with either allowance', () => {
  const policy = playbackPolicyAt(new Date('2026-08-17T18:00:00Z'), settings, { breakCycleSeconds: 12 * 60 })
  assert.equal(policy.breakCycleRemainingSeconds, 18 * 60)
})
