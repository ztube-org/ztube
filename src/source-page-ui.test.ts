import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

for (const page of ['channel/[id].vue', 'playlist/[id].vue']) {
  test(`${page} renders its video grid independently from the search input`, async () => {
    const source = await readFile(new URL(`../app/pages/browse/${page}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /<UInput[^>]+>\s*<div v-else(?:-if)?=/s)
    assert.match(source, /<div v-else-if="filteredVideos\.length" class="zt-video-grid">/)
  })
}
