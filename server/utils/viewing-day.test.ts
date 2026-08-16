import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidTimeZone, viewingDayAt } from './viewing-day.ts'

const settings = { weekdayAllowanceMinutes: 60, weekendAllowanceMinutes: 120 }

test('selects weekday and weekend Daily Allowances in the Child time zone', () => {
  const friday = viewingDayAt(new Date('2026-08-15T06:59:59Z'), 'America/Los_Angeles', settings)
  const saturday = viewingDayAt(new Date('2026-08-15T07:00:00Z'), 'America/Los_Angeles', settings)
  assert.deepEqual(friday, { localDate: '2026-08-14', dayOfWeek: 5, isWeekend: false, allowanceMinutes: 60 })
  assert.deepEqual(saturday, { localDate: '2026-08-15', dayOfWeek: 6, isWeekend: true, allowanceMinutes: 120 })
})

test('changes Viewing Day once at spring-forward local midnight', () => {
  assert.equal(viewingDayAt(new Date('2026-03-08T07:59:59Z'), 'America/Los_Angeles', settings).localDate, '2026-03-07')
  assert.equal(viewingDayAt(new Date('2026-03-08T08:00:00Z'), 'America/Los_Angeles', settings).localDate, '2026-03-08')
  assert.equal(viewingDayAt(new Date('2026-03-09T06:59:59Z'), 'America/Los_Angeles', settings).localDate, '2026-03-08')
  assert.equal(viewingDayAt(new Date('2026-03-09T07:00:00Z'), 'America/Los_Angeles', settings).localDate, '2026-03-09')
})

test('does not create another Viewing Day during the repeated fall-back hour', () => {
  const beforeRepeat = viewingDayAt(new Date('2026-11-01T08:30:00Z'), 'America/Los_Angeles', settings)
  const afterRepeat = viewingDayAt(new Date('2026-11-01T09:30:00Z'), 'America/Los_Angeles', settings)
  assert.equal(beforeRepeat.localDate, '2026-11-01')
  assert.equal(afterRepeat.localDate, '2026-11-01')
})

test('validates fixed IANA time zones', () => {
  assert.equal(isValidTimeZone('Asia/Shanghai'), true)
  assert.equal(isValidTimeZone('America/Los_Angeles'), true)
  assert.equal(isValidTimeZone('Not/A_Zone'), false)
})
