// End-to-end tests: launch the *built* app with a throwaway data dir and a fixture photo folder,
// and drive it like a user would. Run with `npm run test:e2e` (builds first).
// Set E2E_SCREENSHOTS=<dir> to save screenshots along the way.
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

/** Launches the dev build (`.`), or a packaged app when E2E_EXECUTABLE points at its binary. */
const launchWith = (dataDir) =>
  _electron.launch({
    ...(process.env.E2E_EXECUTABLE ? { executablePath: process.env.E2E_EXECUTABLE, args: [] } : { args: ['.'] }),
    // Hidden: never shown on screen and never takes focus (see src/main/index.ts).
    env: { ...process.env, PHOTONIC_USER_DATA: dataDir, PHOTONIC_HIDDEN: '1' }
  })
const userData = join(tmp, 'userdata')
const photos = join(tmp, 'My Photos')
const shots = process.env.E2E_SCREENSHOTS
const results = []

function write(rel, content) {
  mkdirSync(join(photos, rel, '..'), { recursive: true })
  writeFileSync(join(photos, rel), content)
}

async function launch() {
  const app = await launchWith(userData)
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
const waitPath = (win, suffix) =>
  win.waitForFunction((sfx) => document.querySelector('[data-testid=path]')?.textContent.endsWith(sfx), suffix)
const tagStatus = (win) => win.getByTestId('status-tag').getAttribute('data-status')
const stats = (win) =>
  win.evaluate(async () => window.photonic.libraries.stats((await window.photonic.libraries.last()).id))

try {
  // ------------------------------------------------------------------ run 0
  await step('quitting immediately after launch exits cleanly (no hang)', async () => {
    const quick = mkdtempSync(join(tmpdir(), 'photonic-e2e-quick-'))
    const app = await launchWith(quick)
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
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=path]')?.textContent.endsWith('My Photos/broken.jpg')
      )
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
      await waitPath(win, 'My Photos/top.jpg')
      await imageLoaded(win)
      assert.equal(await text(win, 'date'), 'Taken 2019-07-04 14:32')
      await win.keyboard.press('ArrowRight')
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=path]')?.textContent.endsWith('IMG_0001.jpg')
      )
      await imageLoaded(win)
      await shot(win, 'm2-viewer')
    })

    await step('photos without EXIF fall back to the file date, labelled', async () => {
      await win.keyboard.press('End')
      await win.waitForFunction(() => document.querySelector('[data-testid=path]')?.textContent.endsWith('beach.png'))
      assert.match(await text(win, 'date'), /^File created \d{4}-\d\d-\d\d \d\d:\d\d$/) // no 'no EXIF date' note
      await win.keyboard.press('Home')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 5')
      await win.keyboard.press('ArrowLeft') // already at the start: stays
      assert.equal(await text(win, 'position'), '1 / 5')
    })

    await step('the ⏮ / ⏭ buttons jump to the first / last photo', async () => {
      await win.getByRole('button', { name: 'Last photo' }).click()
      await waitPath(win, 'beach.png')
      assert.equal(await win.getByRole('button', { name: 'Last photo' }).isDisabled(), true)
      await win.getByRole('button', { name: 'First photo' }).click()
      await waitPath(win, 'broken.jpg')
      assert.equal(await win.getByRole('button', { name: 'First photo' }).isDisabled(), true)
      await win.keyboard.press('End') // and Home/End still work, pushing the same buttons
      await waitPath(win, 'beach.png')
      await win.keyboard.press('Home')
      await waitPath(win, 'broken.jpg')
      await shot(win, 'first-last')
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

    // ---- M3: marking ----
    await step('↑ Likes and jumps to the next unreviewed photo', async () => {
      await win.keyboard.press('Home')
      await waitPath(win, 'broken.jpg')
      await win.keyboard.press('ArrowUp')
      await waitPath(win, 'top.jpg')
      assert.equal((await stats(win)).like, 1)
    })

    await step('↓ Mehs and moves on', async () => {
      await win.keyboard.press('ArrowDown')
      await waitPath(win, 'IMG_0001.jpg')
      assert.equal((await stats(win)).meh, 1)
    })

    await step('holding ↑ marks once, not repeatedly', async () => {
      await win.keyboard.down('ArrowUp') // likes IMG_0001 → IMG_0002
      await waitPath(win, 'IMG_0002.jpg')
      await win.keyboard.down('ArrowUp') // auto-repeat: must be ignored
      await win.keyboard.down('ArrowUp')
      await win.keyboard.up('ArrowUp')
      await win.waitForTimeout(200)
      assert.match(await text(win, 'path'), /IMG_0002\.jpg$/)
      assert.equal(await tagStatus(win), 'unreviewed')
      assert.equal((await stats(win)).like, 2)
    })

    await step('⌘Z undoes the last mark and goes back to that photo', async () => {
      await win.keyboard.press('Meta+z')
      await waitPath(win, 'IMG_0001.jpg')
      await win.waitForFunction(
        () => document.querySelector('[data-testid=status-tag]')?.dataset.status === 'unreviewed'
      )
      assert.equal((await stats(win)).like, 1)
    })

    await step('reaching the end shows the done screen', async () => {
      await win.keyboard.press('ArrowDown') // IMG_0001 meh → IMG_0002
      await waitPath(win, 'IMG_0002.jpg')
      await win.keyboard.press('ArrowDown') // IMG_0002 meh → beach.png
      await waitPath(win, 'beach.png')
      await win.keyboard.press('ArrowUp') // beach like → nothing unreviewed left
      await win.getByTestId('done-screen').waitFor()
      assert.match(await text(win, 'done-screen'), /LIBRARY CLEAR!/)
      assert.match(await text(win, 'done-screen'), /Press\s+←\s+to go back/)
      await shot(win, 'm3-done')
    })

    await step('U clears a mark; done screen offers to jump back to it with Enter', async () => {
      await win.keyboard.press('ArrowLeft') // close the done screen
      await win.keyboard.press('Home')
      await waitPath(win, 'broken.jpg')
      await win.keyboard.press('u')
      await win.waitForFunction(
        () => document.querySelector('[data-testid=status-tag]')?.dataset.status === 'unreviewed'
      )
      await win.keyboard.press('End')
      await waitPath(win, 'beach.png')
      await win.keyboard.press('ArrowUp') // already liked; still nothing unreviewed after it
      await win.getByTestId('done-screen').waitFor()
      assert.match(await text(win, 'done-screen'), /1 unreviewed earlier/)
      await win.keyboard.press('Enter')
      await waitPath(win, 'broken.jpg')
      const s = await stats(win)
      assert.deepEqual([s.like, s.meh, s.unreviewed], [1, 3, 1])
    })

    await step('Like/Meh buttons work by clicking too', async () => {
      await win.getByRole('button', { name: /Like/ }).click()
      await win.getByTestId('done-screen').waitFor()
      assert.equal((await stats(win)).like, 2)
      await win.keyboard.press('Meta+z')
      await waitPath(win, 'broken.jpg')
      await win.waitForSelector('text=Undone')
      assert.equal((await stats(win)).like, 1)
      // Regression: stale <img>s once piled up in the stage (duplicate React keys).
      await win.waitForSelector("text=Can't display this file.")
      assert.equal(await win.locator('[data-testid=stage] img').count(), 0)
      await win.keyboard.press('ArrowRight')
      await waitPath(win, 'top.jpg')
      await imageLoaded(win)
      assert.equal(await win.locator('[data-testid=stage] img').count(), 1)
      await win.waitForSelector('.mark-flash', { state: 'detached' })
      assert.equal(await win.evaluate(() => document.activeElement?.tagName), 'BODY', 'buttons must not keep focus')
      await shot(win, 'm3-viewer')
    })

    // ---- M4: filters and sort orders ----
    const position = () => text(win, 'position')
    const current = () => win.getByTestId('filter').getAttribute('data-filter')

    await step('filters 1–4 switch between All / Unreviewed / Like / Meh', async () => {
      await win.keyboard.press('3')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 1')
      await waitPath(win, 'beach.png')
      assert.equal(await current(), 'like')
      await win.keyboard.press('4')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 3'))
      await win.keyboard.press('1')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 5'))
      assert.equal(await current(), 'all')
    })

    await step('the filter dropdown shows the current filter and switches by click, arrows or number', async () => {
      assert.match(await text(win, 'filter'), /^All\s*▾$/)
      await win.getByTestId('filter').click()
      const list = win.getByRole('listbox', { name: 'Filter' })
      await list.waitFor()
      // every filter is listed with its key, and the core ones with counts
      assert.equal(await list.getByRole('option').count(), 5)
      assert.match(await win.getByTestId('filter-option-like').innerText(), /3\s+Like\s+1/)
      await shot(win, 'filter-dropdown')
      await win.keyboard.press('ArrowDown') // All → Unreviewed
      await win.keyboard.press('Enter')
      await list.waitFor({ state: 'detached' })
      assert.equal(await current(), 'unreviewed')
      await win.getByTestId('filter').click()
      await win.getByTestId('filter-option-meh').click()
      await win.waitForFunction(() => document.querySelector('[data-testid=filter]')?.dataset.filter === 'meh')
      await win.getByTestId('filter').click()
      await list.waitFor()
      await win.keyboard.press('Escape') // closes without changing anything
      await list.waitFor({ state: 'detached' })
      assert.equal(await current(), 'meh')
      await win.getByTestId('filter').click()
      await win.keyboard.press('1') // number keys work inside the menu too
      await list.waitFor({ state: 'detached' })
      assert.equal(await current(), 'all')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 5'))
      await win.keyboard.press('Home')
      await win.keyboard.press('ArrowRight') // and the viewer's keys are back
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.startsWith('2 /'))
    })

    await step('S cycles Filename → Date → Random; R reshuffles', async () => {
      await win.keyboard.press('Home')
      await waitPath(win, 'broken.jpg') // filename order starts with broken.jpg
      await win.keyboard.press('s')
      await win.waitForFunction(() => document.querySelector('[data-testid=sort]')?.textContent.startsWith('Date'))
      await win.keyboard.press('Home')
      await waitPath(win, 'top.jpg') // oldest EXIF date (ties broken by path: root files first)
      await win.keyboard.press('s')
      await win.waitForFunction(() => document.querySelector('[data-testid=sort]')?.textContent.startsWith('Random'))
      assert.match(await position(), /\/ 5$/)
      await win.keyboard.press('r')
      await win.waitForSelector('text=Reshuffled')
      await win.keyboard.press('s')
      await win.waitForFunction(() => document.querySelector('[data-testid=sort]')?.textContent.startsWith('Filename'))
    })

    await step('there is no folder scope: no scope chip, and G does nothing', async () => {
      assert.equal(await win.getByTestId('scope').count(), 0)
      await win.keyboard.press('g')
      await win.waitForTimeout(150)
      assert.equal(await win.locator('[role=dialog]').count(), 0)
      await win.keyboard.press('2')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 1'))
      await win.keyboard.press('Home')
      await waitPath(win, 'broken.jpg')
    })
    await app.close()
  }

  // ------------------------------------------------------------------ run 2
  rmSync(join(photos, '2019/Italy/IMG_0002.jpg'))
  write('2021/new.jpg', withExif(EXIF_JPEG))
  {
    const { app, win } = await launch()
    await step('relaunch reopens the library at the same photo', async () => {
      await waitPath(win, 'broken.jpg')
    })
    await step('rescan on open picks up added and deleted files', async () => {
      // the Unreviewed view now holds broken.jpg plus the newly added 2021/new.jpg
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 2'))
      const s = await stats(win)
      assert.equal(s.missing, 1)
      assert.equal(s.total, 5)
    })
    await step('marks survive a restart (missing photos keep theirs too)', async () => {
      const marked = await win.evaluate(async () => {
        const lib = await window.photonic.libraries.last()
        return window.photonic.photos.counts(lib.id)
      })
      // beach liked; top, IMG_0001 meh (IMG_0002 meh is now missing, so not counted); broken + new.jpg unreviewed
      assert.deepEqual([marked.like, marked.meh, marked.unreviewed], [1, 2, 2])
    })
    await step('switch to Like, sorted by date…', async () => {
      await win.keyboard.press('3')
      await win.waitForFunction(() => document.querySelector('[data-testid=filter]')?.dataset.filter === 'like')
      await win.keyboard.press('s')
      await win.waitForFunction(() => document.querySelector('[data-testid=sort]')?.textContent.startsWith('Date'))
    })
    await app.close()
  }

  // ------------------------------------------------------------------ run 3
  {
    const { app, win } = await launch()
    await step('…and the view (filter, sort) is restored on the next launch', async () => {
      await win.waitForFunction(() => document.querySelector('[data-testid=filter]')?.dataset.filter === 'like')
      assert.equal(await win.getByTestId('filter').getAttribute('data-filter'), 'like')
      assert.match(await text(win, 'sort'), /^Date/)
      await waitPath(win, 'beach.png')
    })

    // ---- M6: polish ----
    const clickMenu = (id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id)
    const cssVar = (name) =>
      win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

    await step('? shows the keyboard shortcuts; Escape closes them', async () => {
      await win.keyboard.press('Shift+?')
      const dlg = win.getByRole('dialog', { name: 'Keyboard shortcuts' })
      await dlg.waitFor()
      assert.match(await dlg.innerText(), /Order: filename → date → random/)
      await shot(win, 'm6-shortcuts')
      await win.keyboard.press('Escape')
      await dlg.waitFor({ state: 'detached' })
    })

    await step('H hides the toolbars; path and date stay visible', async () => {
      await win.keyboard.press('h')
      await win.waitForFunction(() => document.querySelector('.viewer')?.classList.contains('hud-hidden'))
      assert.equal(await win.locator('.toolbar').isVisible(), false)
      assert.equal(await win.getByTestId('path').isVisible(), true)
      assert.equal(await win.getByTestId('date').isVisible(), true)
      await win.keyboard.press('h')
      await win.locator('.toolbar').waitFor({ state: 'visible' })
    })

    await step('Space zooms to 100% (one image pixel per screen pixel); Escape returns to fit', async () => {
      await imageLoaded(win)
      await win.keyboard.press(' ')
      await win.locator('.zoom-badge').waitFor()
      const { w, expected } = await win.evaluate(() => {
        const img = document.querySelector('[data-testid=stage] img')
        return { w: img.getBoundingClientRect().width, expected: img.naturalWidth / devicePixelRatio }
      })
      assert.ok(Math.abs(w - expected) < 1, `zoomed width ${w} vs ${expected}`)
      await win.keyboard.press('Escape')
      await win.locator('.zoom-badge').waitFor({ state: 'detached' })
    })

    await step('there is no full-screen mode (F opens the folder dialog instead)', async () => {
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreenable()),
        false
      )
      await win.keyboard.press('f')
      const dlg = win.getByRole('dialog', { name: 'Like or Meh a folder' })
      await dlg.waitFor()
      await win.keyboard.press('Escape')
      await dlg.waitFor({ state: 'detached' })
    })

    await step('View → Theme switches palettes live; Appearance → Dark; Animations off', async () => {
      assert.equal(await cssVar('--accent'), '#FFD166') // Arcade by default
      await clickMenu('theme-desert')
      await win.waitForFunction(
        () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#E9C46A'
      )
      await clickMenu('appearance-dark')
      await win.waitForFunction(() => document.documentElement.dataset.mode === 'dark')
      await shot(win, 'm6-desert-dark')
      await clickMenu('theme-arcade')
      await clickMenu('appearance-light')
      await win.waitForFunction(() => document.documentElement.dataset.mode === 'light')
      await clickMenu('animations')
      await win.waitForFunction(() => document.documentElement.dataset.animations === 'off')
      await clickMenu('animations')
      await win.waitForFunction(() => document.documentElement.dataset.animations === 'on')
      await clickMenu('appearance-system')
    })

    await step('Edit → Undo (the ⌘Z menu item) undoes a mark, once', async () => {
      await win.keyboard.press('ArrowDown') // beach: like → meh
      await win.getByTestId('done-screen').waitFor()
      await clickMenu('undo')
      await win.waitForSelector('text=Undone')
      const c = await win.evaluate(async () =>
        window.photonic.photos.counts((await window.photonic.libraries.last()).id)
      )
      assert.equal(c.like, 1)
      assert.equal(c.meh, 2)
    })

    await step('the segmented progress bar shows how much of the library is reviewed', async () => {
      const bar = win.getByTestId('progress')
      assert.equal(await bar.getAttribute('aria-valuenow'), '3') // beach liked; top + IMG_0001 meh
      assert.equal(await bar.getAttribute('aria-valuemax'), '5')
    })

    await step('the library switcher lists libraries (click the name or ⌘L)', async () => {
      await win.getByTestId('library-name').click()
      const dlg = win.getByRole('dialog', { name: 'Switch library' })
      await dlg.getByText('My Photos', { exact: true }).waitFor()
      await win.keyboard.press('Escape')
      await dlg.waitFor({ state: 'detached' })
      await shot(win, 'm6-viewer')
    })
    await app.close()
  }

  // ------------------------------------------------------------------ run 4: dedupe feature
  const dupData = join(tmp, 'userdata-dupes')
  const dupes = join(tmp, 'Dupes')
  const launchDupes = async () => {
    const app = await launchWith(dupData)
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1280, height: 800 })
    return { app, win }
  }
  const dupStats = (win) =>
    win.evaluate(async () => window.photonic.photos.counts((await window.photonic.libraries.last()).id))
  {
    const { app, win } = await launchDupes()
    const [x, y, z] = await makeImages(app, [
      { hue: 0, w: 300, h: 200 },
      { hue: 1, w: 300, h: 200 },
      { hue: 2, w: 300, h: 200 }
    ])
    const put = (rel, buf) => {
      mkdirSync(join(dupes, rel, '..'), { recursive: true })
      writeFileSync(join(dupes, rel), buf)
    }
    put('a.jpg', x)
    put('copies/a.jpg', x)
    put('copies/old/a copy.jpg', x)
    put('b.jpg', y)
    put('z/b.jpg', y)
    put('c.jpg', z)

    await step('dedupe: after hashing, a banner reports the duplicate copies', async () => {
      await stubFolderDialog(app, dupes)
      await win.click('text=Open a folder…')
      await win.getByTestId('dup-banner').waitFor({ timeout: 20_000 })
      assert.match(await text(win, 'dup-banner'), /3 duplicate copies found/)
      await waitPath(win, 'Dupes/a.jpg')
      await shot(win, 'm5-banner')
    })

    await step('dedupe: info bar shows "1 of 3 copies"; D lists the other copies', async () => {
      await win.waitForFunction(
        () => document.querySelector('[data-testid=copies-badge]')?.textContent === '1 of 3 copies'
      )
      await win.keyboard.press('d')
      const panel = win.getByRole('dialog', { name: 'Identical copies' })
      await panel.getByText('copies/old/a copy.jpg', { exact: false }).waitFor()
      const dialog = await panel.innerText()
      assert.match(dialog, /copies\/a\.jpg/)
      assert.match(dialog, /copies\/old\/a copy\.jpg/)
      await win.keyboard.press('ArrowRight') // shortcuts are paused while the dialog is open
      await win.keyboard.press('Escape')
      await win.getByRole('dialog').waitFor({ state: 'detached' })
      await waitPath(win, 'Dupes/a.jpg')
    })

    await step('dedupe: 5 shows only duplicated photos, copies grouped together', async () => {
      await win.keyboard.press('5')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 5'))
      const order = await win.evaluate(async () => {
        const lib = await window.photonic.libraries.last()
        const ids = await window.photonic.photos.listIds({
          libraryId: lib.id,
          filter: 'duplicates',
          sort: 'filename'
        })
        return Promise.all(ids.map(async (i) => (await window.photonic.photos.get(i)).relPath))
      })
      assert.deepEqual(order, ['a.jpg', 'copies/a.jpg', 'copies/old/a copy.jpg', 'b.jpg', 'z/b.jpg'])
      await win.keyboard.press('2')
    })

    await step('dedupe: Hide duplicates hides the extra copies from review — without marking them Meh', async () => {
      await win.getByRole('button', { name: 'Hide duplicates' }).click()
      await win.getByRole('dialog', { name: 'Hide duplicates' }).waitFor()
      await shot(win, 'm5-confirm')
      await win.keyboard.press('Enter')
      await win.waitForSelector('text=Hid 3 duplicate copies')
      // each photo now comes up once: 3 left to review, and nothing was marked Meh
      assert.deepEqual(await dupStats(win), { total: 3, unreviewed: 3, like: 0, meh: 0 })
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 3'))
      await win.getByTestId('dup-banner').waitFor({ state: 'detached' })
    })

    await step('dedupe: the Duplicates view still shows hidden copies, labelled', async () => {
      await win.keyboard.press('5')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 5'))
      await win.keyboard.press('ArrowRight') // copies/a.jpg: a hidden copy
      await waitPath(win, 'copies/a.jpg')
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=copies-badge]')?.textContent.startsWith('Hidden copy')
      )
      assert.equal(await tagStatus(win), 'unreviewed')
      await shot(win, 'm5-hidden-copy')
      await win.keyboard.press('2')
    })

    await step('dedupe: one ⌘Z brings all the hidden copies back', async () => {
      await win.keyboard.press('Meta+z')
      await win.waitForSelector('text=Undid 3 changes')
      assert.deepEqual(await dupStats(win), { total: 6, unreviewed: 6, like: 0, meh: 0 })
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 6'))
    })

    await step('dedupe: a renamed file keeps its mark after a rescan', async () => {
      // Like c.jpg, rename it on disk, rescan
      await win.evaluate(async () => {
        const lib = await window.photonic.libraries.last()
        const ids = await window.photonic.photos.listIds({
          libraryId: lib.id,
          filter: 'all',
          sort: 'filename'
        })
        for (const i of ids)
          if ((await window.photonic.photos.get(i)).relPath === 'c.jpg') await window.photonic.marks.set(i, 'like')
      })
      renameSync(join(dupes, 'c.jpg'), join(dupes, 'c-renamed.jpg'))
      await win.evaluate(async () => window.photonic.libraries.rescan((await window.photonic.libraries.last()).id))
      const s = await stats(win)
      assert.equal(s.missing, 0)
      assert.equal(s.like, 1)
    })

    // ---- Like / Meh a whole folder (F) ----
    const folderDialog = () => win.getByRole('dialog', { name: 'Like or Meh a folder' })
    const openFolderDialog = async (path) => {
      await win.keyboard.press('f')
      await folderDialog().waitFor()
      await win.getByTestId('folder-path').fill(path)
    }

    await step('F: type a folder path, see how many photos it has, ↓ Mehs them all', async () => {
      await openFolderDialog(join(dupes, 'copies'))
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=folder-summary]')?.textContent.startsWith('2 photos in this folder')
      )
      await shot(win, 'folder-dialog')
      await win.keyboard.press('ArrowDown') // Meh, straight from the path field
      await folderDialog().waitFor({ state: 'detached' })
      await win.waitForSelector('text=Marked 2 photos Meh')
      assert.equal((await dupStats(win)).meh, 2)
    })

    await step('F: marking over the opposite mark asks first (only-unreviewed / all)', async () => {
      await openFolderDialog(join(dupes, 'copies'))
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=folder-summary]')?.textContent.includes('2 Meh')
      )
      await folderDialog().getByRole('button', { name: /Like/ }).click()
      await win.getByTestId('folder-confirm').waitFor()
      assert.match(
        await text(win, 'folder-confirm'),
        /^2 photos in that folder are marked Meh\. Do you want to overwrite that\?$/
      )
      await shot(win, 'folder-confirm')
      await win.keyboard.press('u') // Like only the unreviewed ones: there are none
      await win.waitForSelector('text=Nothing to change')
      assert.equal((await dupStats(win)).meh, 2)

      await openFolderDialog(join(dupes, 'copies'))
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=folder-summary]')?.textContent.includes('2 Meh')
      )
      await win.keyboard.press('ArrowUp')
      await win.getByTestId('folder-confirm').waitFor()
      await folderDialog().getByRole('button', { name: 'Like them all' }).click()
      await win.waitForSelector('text=Marked 2 photos Like')
      const s = await dupStats(win)
      assert.equal(s.meh, 0)
      assert.equal(s.like, 3) // + c-renamed.jpg from before
    })

    await step('F: one ⌘Z undoes the whole folder', async () => {
      await win.keyboard.press('Meta+z')
      await win.waitForSelector('text=Undid 2 changes')
      const s = await dupStats(win)
      assert.equal(s.meh, 2)
      assert.equal(s.like, 1)
    })

    await step('F: a folder outside the library is refused', async () => {
      await openFolderDialog(tmp)
      await win.waitForFunction(() =>
        document.querySelector('[data-testid=folder-summary]')?.textContent.includes("isn't inside this library")
      )
      assert.equal(await folderDialog().getByRole('button', { name: /Like/ }).isDisabled(), true)
      await win.keyboard.press('Escape')
      await folderDialog().waitFor({ state: 'detached' })
    })

    await step('dedupe: Dismiss hides the banner', async () => {
      await win.getByRole('button', { name: 'Dismiss' }).click()
      await win.getByTestId('dup-banner').waitFor({ state: 'detached' })
      // turn the feature off for the next launch (same as unticking View → Duplicate Detection)
      await win.evaluate(() => window.photonic.settings.set('feature.dedupe', false))
    })
    await app.close()
  }
  {
    const { app, win } = await launchDupes()
    await step(
      'dedupe off: the app works without it — no Duplicates filter, no badge, renames become new photos',
      async () => {
        await win.getByTestId('filter').click()
        await win.getByTestId('filter-option-unreviewed').waitFor()
        assert.equal(await win.getByTestId('filter-option-duplicates').count(), 0)
        await win.keyboard.press('Escape')
        assert.deepEqual(await win.evaluate(() => window.photonic.features.enabled()), [])
        await waitPath(win, '.jpg')
        assert.equal(await win.getByTestId('copies-badge').count(), 0)
        renameSync(join(dupes, 'c-renamed.jpg'), join(dupes, 'c-again.jpg'))
        await win.evaluate(async () => window.photonic.libraries.rescan((await window.photonic.libraries.last()).id))
        const s = await stats(win)
        assert.equal(s.missing, 1) // without hashes, the old row is just missing
        await win.keyboard.press('ArrowUp')
        await win.keyboard.press('Meta+z') // marking and undo still work
        await shot(win, 'm5-off')
      }
    )
    await app.close()
  }

  assert.ok(readdirSync(userData).includes('photonic.db'))
  assert.equal(readdirSync(join(userData, 'backups')).length, 1, 'later launches within 24h must not back up again')
  console.log(`e2e: ${results.length} checks passed`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
