import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'

test('declares an installable standalone iPad web app with adaptive color schemes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')

  assert.match(html, /name="color-scheme" content="light dark"/)
  assert.match(html, /localStorage\.getItem\('ztube-theme'\)/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=2"/)
  assert.match(viteConfig, /ui\(\{\s*colorMode:\s*false\s*\}\)/)
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.background_color, '#f3f0e8')
  assert.ok(manifest.icons.every((icon: { src: string }) => icon.src.endsWith('?v=2')))
})

test('standalone topbars reserve the iPad status-bar safe area', async () => {
  const [styles, shell, watch] = await Promise.all([
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
    readFile(new URL('../app/app.vue', import.meta.url), 'utf8'),
    readFile(new URL('../app/pages/watch.vue', import.meta.url), 'utf8'),
  ])

  assert.match(shell, /<header class="zt-app-header/)
  assert.match(watch, /<header class="zt-app-header[^"\n]*\bmin-h-14\b/)
  assert.match(styles, /\.zt-app-header\s*\{[^}]*padding-block-start:\s*env\(safe-area-inset-top\);/s)
  assert.match(styles, /\.zt-watch-related\s*\{[^}]*top:\s*calc\(4\.5rem \+ env\(safe-area-inset-top\)\);/s)
})

test('the iPad home-screen icon contains a horizontal brand mark', async () => {
  const icon = await readFile(new URL('../public/apple-touch-icon.png', import.meta.url))
  const { data, info } = await sharp(icon)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels
    return [...data.subarray(offset, offset + 3)]
  }

  assert.deepEqual(pixel(0, 0), [243, 240, 232], 'the blue mark must not fill the square icon canvas')

  const bluePixels: Array<[number, number]> = []
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const [red, green, blue] = pixel(x, y)
      if (blue > red * 1.5 && blue > green * 1.2) bluePixels.push([x, y])
    }
  }

  const xs = bluePixels.map(([x]) => x)
  const ys = bluePixels.map(([, y]) => y)
  const markWidth = Math.max(...xs) - Math.min(...xs) + 1
  const markHeight = Math.max(...ys) - Math.min(...ys) + 1
  assert.ok(markWidth > markHeight, 'the blue brand mark must be wider than it is tall')
})
