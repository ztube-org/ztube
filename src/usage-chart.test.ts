import assert from 'node:assert/strict'
import test from 'node:test'
import { usageChartScale } from './usage-chart.ts'

test('usage chart provides readable minute ticks for empty, short, and long viewing days', () => {
  for (const values of [[], [0, 0], [15, 30], [3600, 10801, 14400], [86400]]) {
    const { ceiling, ticks } = usageChartScale(values)
    assert.ok(ceiling > 0)
    assert.ok(values.every(value => value / 60 <= ceiling), 'no clipping above three hours')
    assert.equal(ticks[0], 0)
    assert.equal(ticks.at(-1), ceiling)
    assert.ok(ticks.length >= 2 && ticks.length <= 6)
    assert.ok(ticks.every((value, index) => !index || value > ticks[index - 1]))
  }
})
