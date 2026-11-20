// End-to-end smoke test: launches the *built* app with a throwaway data dir and a fixture photo
// folder, and drives it like a user. Run with `npm run test:e2e` (builds first).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'

// A tiny JPEG whose EXIF says: Canon EOS R6, taken 2019:07:04 14:32:10 (see tests/fixtures.ts).
const EXIF_JPEG = Buffer.from(
  '/9j/4QBuRXhpZgAASUkqAAgAAAADAA8BAgAGAAAAMgAAABABAgAHAAAAOAAAAGmHBAABAAAAQAAAAAAAAABDYW5vbgBFT1MgUjYAAAEAA5ACABQAAABSAAAAAAAAADIwMTk6MDc6MDQgMTQ6MzI6MTAA/9k=',
  'base64'
)

const tmp = mkdtempSync(join(tmpdir(), 'photonic-e2e-'))
const userData = join(tmp, 'userdata')
const photos = join(tmp, 'My Photos')
const screenshots = process.env.E2E_SCREENSHOTS

function writePhotos(files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(photos, rel, '..'), { recursive: true })
    writeFileSync(join(photos, rel), content)
  }
}

async function launch() {
  const app = await _electron.launch({ args: ['.'], env: { ...process.env, PHOTONIC_USER_DATA: userData } })
  const win = await app.firstWindow()
  return { app, win }
}

/** Replaces the native folder dialog (which Playwright can't click) with one that picks `dir`. */
async function stubFolderDialog(app, dir) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, dir)
}

const statsText = (win) => win.locator('.card dl').innerText()

try {
  writePhotos({
    '2019/Italy/IMG_0001.jpg': EXIF_JPEG,
    '2019/Italy/IMG_0002.jpg': EXIF_JPEG,
    '2019/Italy/clip.mov': 'not a photo',
    '2019/Italy/IMG_0003.HEIC': 'skipped',
    '2020/a.png': 'no exif',
    'top.jpg': EXIF_JPEG,
    '.hidden/secret.jpg': EXIF_JPEG
  })

  // --- Run 1: first launch, open a folder, scan finishes ---
  {
    const { app, win } = await launch()
    await win.waitForSelector('text=Choose a folder of photos')
    assert.equal(await win.evaluate(() => typeof require), 'undefined', 'renderer must not have Node')

    await stubFolderDialog(app, photos)
    await win.click('text=Open a folder…')
    await win.waitForSelector('text=Up to date', { timeout: 15_000 })

    const stats = await statsText(win)
    assert.match(stats, /Photos\s+4\b/, stats)
    assert.match(stats, /Folders\s+3\b/, stats)
    assert.match(stats, /Unreviewed\s+4\b/, stats)
    assert.match(stats, /Dates read\s+4 \(3 with a capture date\)/, stats)
    assert.match(stats, /Missing\s+0\b/, stats)
    assert.match(await win.locator('.card .path').innerText(), /My Photos$/)
    if (screenshots) await win.screenshot({ path: join(screenshots, 'm1-scanned.png') })
    await app.close()
    console.log('run 1: open folder + scan: ok')
  }

  // --- Run 2: relaunch reopens the library and rescans; a deleted and an added file are picked up ---
  rmSync(join(photos, 'top.jpg'))
  writePhotos({ '2021/new.jpg': EXIF_JPEG })
  {
    const { app, win } = await launch()
    await win.waitForSelector('text=Up to date', { timeout: 15_000 })
    const status = await win.locator('.status').innerText()
    assert.match(status, /1 new, 0 changed, 1 newly missing/, status)
    const stats = await statsText(win)
    assert.match(stats, /Photos\s+4\b/, stats)
    assert.match(stats, /Missing\s+1\b/, stats)
    if (screenshots) await win.screenshot({ path: join(screenshots, 'm1-rescan.png') })
    await app.close()
    console.log('run 2: reopen last library + rescan: ok')
  }

  assert.ok(readdirSync(userData).includes('photonic.db'))
  assert.equal(readdirSync(join(userData, 'backups')).length, 1, 'second launch within 24h must not back up again')
  console.log('e2e smoke: passed')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
