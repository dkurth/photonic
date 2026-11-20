// End-to-end tests: launch the *built* app with a throwaway data dir and a fixture photo folder,
// and drive it like a user would. Run with `npm run test:e2e` (builds first).
// Set E2E_SCREENSHOTS=<dir> to save screenshots along the way.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'

// EXIF (APP1) block saying: Canon EOS R6, taken 2019:07:04 14:32:10 — built by tests/fixtures.ts.
const EXIF_JPEG = Buffer.from(
  '/9j/4QBuRXhpZgAASUkqAAgAAAADAA8BAgAGAAAAMgAAABABAgAHAAAAOAAAAGmHBAABAAAAQAAAAAAAAABDYW5vbgBFT1MgUjYAAAEAA5ACABQAAABSAAAAAAAAADIwMTk6MDc6MDQgMTQ6MzI6MTAA/9k=',
  'base64'
)
const APP1 = EXIF_JPEG.subarray(2, EXIF_JPEG.length - 2) // strip SOI and EOI

const tmp = mkdtempSync(join(tmpdir(), 'photonic-e2e-'))
const userData = join(tmp, 'userdata')
const photos = join(tmp, 'My Photos')
const shots = process.env.E2E_SCREENSHOTS
const results = []

function write(rel, content) {
  mkdirSync(join(photos, rel, '..'), { recursive: true })
  writeFileSync(join(photos, rel), content)
}

async function launch() {
  const app = await _electron.launch({ args: ['.'], env: { ...process.env, PHOTONIC_USER_DATA: userData } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1280, height: 800 })
  return { app, win }
}

/** Real, decodable images: gradient bitmaps encoded by Electron itself. */
async function makeImages(app, specs) {
  const out = await app.evaluate(({ nativeImage }, specs) => {
    return specs.map(({ hue, w, h, png }) => {
      const buf = Buffer.alloc(w * h * 4)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const t = x / w
          const s = y / h
          // BGRA
          buf[i] = Math.round(255 * (0.3 + 0.7 * s) * ((hue + 2) % 3 === 0 ? 1 : 0.35))
          buf[i + 1] = Math.round(255 * (0.25 + 0.75 * t) * ((hue + 1) % 3 === 0 ? 1 : 0.45))
          buf[i + 2] = Math.round(255 * (1 - 0.6 * t) * (hue % 3 === 0 ? 1 : 0.5))
          buf[i + 3] = 255
        }
      }
      const img = nativeImage.createFromBitmap(buf, { width: w, height: h })
      return (png ? img.toPNG() : img.toJPEG(85)).toString('base64')
    })
  }, specs)
  return out.map((b64) => Buffer.from(b64, 'base64'))
}

const withExif = (jpeg) => Buffer.concat([jpeg.subarray(0, 2), APP1, jpeg.subarray(2)])

/** Replaces the native folder dialog (which Playwright can't click) with one that picks `dir`. */
async function stubFolderDialog(app, dir) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, dir)
}

async function step(name, fn) {
  await fn()
  results.push(name)
  console.log(`  ✓ ${name}`)
}

const text = (win, testId) => win.getByTestId(testId).innerText()
const shot = async (win, name) => shots && win.screenshot({ path: join(shots, `${name}.png`) })
const imageLoaded = (win) =>
  win.waitForFunction(() => {
    const img = document.querySelector('[data-testid=stage] img')
    return img && img.complete && img.naturalWidth > 0
  })
const stats = (win) => win.evaluate(async () => window.photonic.libraries.stats((await window.photonic.libraries.last()).id))

try {
  // ------------------------------------------------------------------ run 0
  await step('quitting immediately after launch exits cleanly (no hang)', async () => {
    const quick = mkdtempSync(join(tmpdir(), 'photonic-e2e-quick-'))
    const app = await _electron.launch({ args: ['.'], env: { ...process.env, PHOTONIC_USER_DATA: quick } })
    await app.firstWindow()
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('app.close() hung')), 10_000))
    try {
      await Promise.race([app.close(), timeout])
    } catch (e) {
      app.process().kill('SIGKILL')
      throw e
    } finally {
      rmSync(quick, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------------------------ run 1
  {
    const { app, win } = await launch()
    const [a, b, c, d] = await makeImages(app, [
      { hue: 0, w: 900, h: 600 },
      { hue: 1, w: 600, h: 900 },
      { hue: 2, w: 900, h: 600 },
      { hue: 1, w: 640, h: 480, png: true }
    ])
    write('2019/Italy/IMG_0001.jpg', withExif(a))
    write('2019/Italy/IMG_0002.jpg', withExif(b))
    write('2019/Italy/clip.mov', 'not a photo')
    write('2019/Italy/IMG_0003.HEIC', 'skipped')
    write('2020/beach.png', d)
    write('top.jpg', withExif(c))
    write('.hidden/secret.jpg', withExif(a))
    write('broken.jpg', 'definitely not a jpeg')

    await step('welcome screen; renderer has no Node access', async () => {
      await win.waitForSelector('text=Choose a folder of photos')
      assert.equal(await win.evaluate(() => typeof require), 'undefined')
      await shot(win, 'm2-welcome')
    })

    await step('open folder → scan → first photo shown with full path and EXIF date', async () => {
      await stubFolderDialog(app, photos)
      await win.click('text=Open a folder…')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 5')
      // natural sort, folder's own files first: broken.jpg, top.jpg, then 2019/Italy/…, 2020/…
      await win.waitForFunction(() => document.querySelector('[data-testid=path]')?.textContent.endsWith('My Photos/broken.jpg'))
      const s = await stats(win)
      assert.equal(s.total, 5)
      assert.equal(s.folders, 3)
    })

    await step('unreadable file shows a placeholder, not a blank stage', async () => {
      await win.waitForSelector("text=Can't display this file.")
    })

    await step('→ moves to the next photo; dates come from EXIF', async () => {
      await win.keyboard.press('ArrowRight')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '2 / 5')
      assert.match(await text(win, 'path'), /My Photos\/top\.jpg$/)
      await imageLoaded(win)
      assert.equal(await text(win, 'date'), 'Taken 2019-07-04 14:32')
      await win.keyboard.press('ArrowRight')
      await win.waitForFunction(() => document.querySelector('[data-testid=path]')?.textContent.endsWith('IMG_0001.jpg'))
      await imageLoaded(win)
      await shot(win, 'm2-viewer')
    })

    await step('photos without EXIF fall back to the file date, labelled', async () => {
      await win.keyboard.press('End')
      await win.waitForFunction(() => document.querySelector('[data-testid=path]')?.textContent.endsWith('beach.png'))
      assert.match(await text(win, 'date'), /^File created \d{4}-\d\d-\d\d \d\d:\d\d · no EXIF date$/)
      await win.keyboard.press('Home')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 5')
      await win.keyboard.press('ArrowLeft') // already at the start: stays
      assert.equal(await text(win, 'position'), '1 / 5')
    })

    await step('C copies the full path', async () => {
      await win.keyboard.press('ArrowRight')
      await win.waitForFunction(() => document.querySelector('[data-testid=path]')?.textContent.endsWith('top.jpg'))
      await win.keyboard.press('c')
      await win.waitForSelector('text=Path copied')
      const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
      assert.equal(clip, (await text(win, 'path')).trim())
    })

    await step('photo:// only serves library photos', async () => {
      const load = (src) =>
        win.evaluate(
          (src) =>
            new Promise((resolve) => {
              const img = new Image()
              img.onload = () => resolve('loaded')
              img.onerror = () => resolve('error')
              img.src = src
            }),
          src
        )
      assert.equal(await load('photo://img/999999'), 'error')
      assert.equal(await load(await win.locator('[data-testid=stage] img').getAttribute('src')), 'loaded')
    })
    await app.close()
  }

  // ------------------------------------------------------------------ run 2
  rmSync(join(photos, '2019/Italy/IMG_0002.jpg'))
  write('2021/new.jpg', withExif(EXIF_JPEG))
  {
    const { app, win } = await launch()
    await step('relaunch reopens the library at the same photo', async () => {
      await win.waitForFunction(() => document.querySelector('[data-testid=path]')?.textContent.endsWith('top.jpg'))
    })
    await step('rescan on open picks up added and deleted files', async () => {
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 5'))
      const s = await stats(win)
      assert.equal(s.missing, 1)
      assert.equal(s.total, 5)
    })
    await app.close()
  }

  assert.ok(readdirSync(userData).includes('photonic.db'))
  assert.equal(readdirSync(join(userData, 'backups')).length, 1, 'second launch within 24h must not back up again')
  console.log(`e2e: ${results.length} checks passed`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
