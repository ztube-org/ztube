import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('declares an installable standalone iPad web app with a fixed light color scheme', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')

  assert.match(html, /<html[^>]+class="light"/)
  assert.match(html, /name="color-scheme" content="light"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(viteConfig, /ui\(\{\s*colorMode:\s*false\s*\}\)/)
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.background_color, '#f9f9f9')
})
