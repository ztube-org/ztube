import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Approved Content cards use larger responsive artwork', async () => {
  const [home, styles] = await Promise.all([
    read('app/pages/browse/index.vue'),
    read('src/style.css'),
  ])

  assert.match(home, /class="zt-source-artwork\b/)
  assert.match(styles, /\.zt-source-artwork\s*\{[^}]*inline-size:\s*5rem;[^}]*block-size:\s*5rem;/s)
  assert.match(styles, /@media\s*\(min-width:\s*768px\)[\s\S]*\.zt-source-artwork\s*\{[^}]*inline-size:\s*6rem;[^}]*block-size:\s*6rem;/s)
})

test('the home page confirms before removing a Favorite', async () => {
  const home = await read('app/pages/browse/index.vue')
  const confirmation = home.indexOf('if (!confirm(`Remove “${video.videoTitle}” from Favorites?`)) return')
  const deletion = home.indexOf("method: 'DELETE'")
  assert.ok(confirmation >= 0)
  assert.ok(deletion > confirmation)
})

test('source pages anchor their Favorite control to the video card', async () => {
  const [source, styles] = await Promise.all([
    read('app/components/SourceVideoPage.vue'),
    read('src/style.css'),
  ])

  assert.match(source, /class="zt-video-card__media"/)
  assert.match(source, /class="zt-video-card__favorite"/)
  assert.match(styles, /\.zt-video-card__media\s*\{[^}]*position:\s*relative;/s)
  assert.match(styles, /\.zt-video-card__favorite\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start:\s*0\.5rem;[^}]*inset-inline-end:\s*0\.5rem;/s)
})

test('desktop watch page pairs a compact player with same-source videos', async () => {
  const [watch, styles] = await Promise.all([
    read('app/pages/watch.vue'),
    read('src/style.css'),
  ])

  assert.match(watch, /class="zt-watch-layout"/)
  assert.match(watch, /class="zt-watch-related\b/)
  assert.match(watch, /relatedVideos/)
  assert.match(styles, /@media\s*\(min-width:\s*1024px\)[\s\S]*\.zt-watch-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(18rem,\s*22rem\);/s)
})

test('same-source video links carry their source and remount the player', async () => {
  const [source, watch, shell] = await Promise.all([
    read('app/components/SourceVideoPage.vue'),
    read('app/pages/watch.vue'),
    read('app/app.vue'),
  ])

  assert.match(source, /\/watch\?v=\$\{video\.videoId\}&\$\{kind\}=\$\{sourceId\}/)
  assert.match(watch, /const relatedVideos = computed/)
  assert.match(watch, /channelParam/)
  assert.match(watch, /if \(disposed\) throw new Error\('Playback page changed'\)/)
  assert.match(watch, /player\.value\?\.destroy\?\.\(\)/)
  assert.match(shell, /<RouterView v-if="route\.meta\.fullscreen" :key="route\.fullPath"/)
})
