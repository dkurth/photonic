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
    const img = document.querySelector('[data-testid=stage] img.current')
    return img && img.complete && img.naturalWidth > 0
  })
const waitPath = (win, suffix) =>
  win.waitForFunction((sfx) => document.querySelector('[data-testid=path]')?.textContent.endsWith(sfx), suffix)
const tagStatus = (win) => win.getByTestId('status-tag').getAttribute('data-status')
// Built-in playlist ids in a fresh database: Like = 1 (on ↑), Meh = 2 (on ↓).
const LIKE = 1
const MEH = 2
/** Library stats plus like/meh counts (from the per-playlist counts). */
const stats = (win) =>
  win.evaluate(async () => {
    const id = (await window.photonic.libraries.last()).id
    const [s, c] = await Promise.all([window.photonic.libraries.stats(id), window.photonic.photos.counts(id)])
    return { ...s, like: c.byPlaylist[1] ?? 0, meh: c.byPlaylist[2] ?? 0 }
  })
/** Counts as { total, unreviewed, like, meh }. */
const counts = (win) =>
  win.evaluate(async () => {
    const c = await window.photonic.photos.counts((await window.photonic.libraries.last()).id)
    return { total: c.total, unreviewed: c.unreviewed, like: c.byPlaylist[1] ?? 0, meh: c.byPlaylist[2] ?? 0 }
  })
const filterValue = (win) => win.getByTestId('filter').getAttribute('data-value')
const playlistValue = (win) => win.getByTestId('playlists').getAttribute('data-value')
/** Choose a playlist to view from the Playlists dropdown. */
const viewPlaylist = async (win, id) => {
  await win.getByTestId('playlists').click()
  await win.getByTestId(`playlist-option-${id}`).click()
  await win.waitForFunction((v) => document.querySelector('[data-testid=playlists]')?.dataset.value === String(v), id)
}

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
      assert.equal(await load(await win.locator('[data-testid=stage] img.current').getAttribute('src')), 'loaded')
    })

    // ---- M3: marking ----
    await step('↑ Likes and jumps to the next unreviewed photo; only the Like button wiggles', async () => {
      await win.keyboard.press('Home')
      await waitPath(win, 'broken.jpg')
      await win.keyboard.press('ArrowUp')
      await win.waitForSelector('.toolbar .btn.like.wiggle')
      assert.equal(await win.locator('.toolbar .btn.meh.wiggle').count(), 0)
      assert.equal(await win.locator('.stage .mark-flash, .stage .pixel-hearts').count(), 0)
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
      // Regression: stale <img>s once piled up in the stage (duplicate React keys). Now the stage
      // holds the current photo plus a few invisible standby ones, never more.
      await win.waitForSelector("text=Can't display this file.")
      assert.equal(await win.locator('[data-testid=stage] img.current').count(), 0)
      assert.ok((await win.locator('[data-testid=stage] img').count()) <= 4)
      await win.keyboard.press('ArrowRight')
      await waitPath(win, 'top.jpg')
      await imageLoaded(win)
      assert.equal(await win.locator('[data-testid=stage] img.current').count(), 1)
      assert.equal(await win.locator('.mark-flash').count(), 0) // no overlay in the middle any more
      assert.equal(await win.evaluate(() => document.activeElement?.tagName), 'BODY', 'buttons must not keep focus')
      await shot(win, 'm3-viewer')
    })

    // ---- M4: filters and sort orders ----
    const position = () => text(win, 'position')
    const current = () => filterValue(win)

    await step('filters 1–2 switch between All / Unreviewed; Like and Meh live in the Playlists dropdown', async () => {
      await viewPlaylist(win, LIKE)
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 1')
      await waitPath(win, 'beach.png')
      assert.equal(await current(), `playlist:${LIKE}`)
      assert.match(await text(win, 'filter'), /^Filter\s*▾$/) // no core filter active while viewing a playlist
      await viewPlaylist(win, MEH)
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 3'))
      await win.keyboard.press('1')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 5'))
      assert.equal(await current(), 'all')
      assert.equal(await playlistValue(win), '')
    })

    await step('the filter dropdown shows the current filter and switches by click, arrows or number', async () => {
      assert.match(await text(win, 'filter'), /^All\s*▾$/)
      await win.getByTestId('filter').click()
      const list = win.getByRole('listbox', { name: 'Filter' })
      await list.waitFor()
      // All, Unreviewed, and Duplicates (the dedupe feature) — each with its key
      assert.equal(await list.getByRole('option').count(), 3)
      assert.match(await win.getByTestId('filter-option-unreviewed').innerText(), /2\s+Unreviewed\s+1/)
      await shot(win, 'filter-dropdown')
      await win.keyboard.press('ArrowDown') // All → Unreviewed
      await win.keyboard.press('Enter')
      await list.waitFor({ state: 'detached' })
      assert.equal(await current(), 'unreviewed')
      await win.getByTestId('filter').click()
      await win.getByTestId('filter-option-all').click()
      await win.waitForFunction(() => document.querySelector('[data-testid=filter]')?.dataset.value === 'all')
      await win.getByTestId('filter').click()
      await list.waitFor()
      await win.keyboard.press('Escape') // closes without changing anything
      await list.waitFor({ state: 'detached' })
      assert.equal(await current(), 'all')
      await win.getByTestId('filter').click()
      await win.keyboard.press('2') // number keys work inside the menu too
      await list.waitFor({ state: 'detached' })
      assert.equal(await current(), 'unreviewed')
      await win.keyboard.press('1')
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
      assert.deepEqual([marked.byPlaylist[LIKE], marked.byPlaylist[MEH], marked.unreviewed], [1, 2, 2])
    })
    await step('switch to Like, sorted by date…', async () => {
      await viewPlaylist(win, LIKE)
      await win.keyboard.press('s')
      await win.waitForFunction(() => document.querySelector('[data-testid=sort]')?.textContent.startsWith('Date'))
    })
    await app.close()
  }

  // ------------------------------------------------------------------ run 3
  {
    const { app, win } = await launch()
    await step('…and the view (filter, sort) is restored on the next launch', async () => {
      await win.waitForFunction(() => document.querySelector('[data-testid=playlists]')?.dataset.value === '1')
      assert.equal(await filterValue(win), `playlist:${LIKE}`)
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
        const img = document.querySelector('[data-testid=stage] img.current')
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
      const dlg = win.getByRole('dialog', { name: 'Put a folder in a playlist' })
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
      const c = await counts(win)
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

    // ---- Playlists ----
    const manage = () => win.getByRole('dialog', { name: 'Manage playlists' })
    const openManage = async () => {
      await win.getByTestId('playlists').click()
      await win.getByTestId('manage-playlists').click()
      await manage().waitFor()
    }
    const playlistsNow = () => win.evaluate(() => window.photonic.playlists.list())
    const keyOf = async (name) => (await playlistsNow()).find((p) => p.name === name)?.shortcut ?? null
    const setKey = async (id, key) => {
      await win.getByTestId(`playlist-key-${id}`).click()
      await win.waitForFunction(
        (i) => document.querySelector(`[data-testid=playlist-key-${i}]`)?.textContent === 'Press a key…',
        id
      )
      await win.keyboard.press(key)
    }
    let MEMES, CATS

    await step('Manage Playlists: create playlists; they start without a key', async () => {
      await win.keyboard.press('1') // view All
      await openManage()
      for (const name of ['memes', 'cats']) {
        await win.getByTestId('new-playlist-name').fill(name)
        await win.keyboard.press('Enter')
        await win.waitForFunction(
          (n) => [...document.querySelectorAll('[data-testid^=playlist-name-]')].some((i) => i.value === n),
          name
        )
      }
      const all = await playlistsNow()
      MEMES = all.find((p) => p.name === 'memes').id
      CATS = all.find((p) => p.name === 'cats').id
      assert.deepEqual(
        all.map((p) => p.name),
        ['cats', 'Like', 'Meh', 'memes']
      ) // alphabetical
      assert.equal(await keyOf('memes'), null)
    })

    await step('a free key is assigned straight away', async () => {
      await setKey(CATS, 'k')
      await win.waitForFunction(async () => (await window.photonic.playlists.list()).some((p) => p.shortcut === 'k'))
      assert.equal(await keyOf('cats'), 'k')
    })

    await step('a key used by another playlist asks first, then moves it (↑ from Like to memes)', async () => {
      await setKey(MEMES, 'ArrowUp')
      const conflict = win.getByTestId('key-conflict')
      await conflict.waitFor()
      assert.match(await conflict.innerText(), /is used by Like\. Give it to memes instead\?/)
      await shot(win, 'playlist-key-conflict')
      await conflict.getByRole('button', { name: 'Move it' }).click()
      await conflict.waitFor({ state: 'detached' })
      await win.waitForFunction(
        async () => (await window.photonic.playlists.list()).find((p) => p.name === 'memes')?.shortcut === 'ArrowUp'
      )
      assert.equal(await keyOf('Like'), null)
    })

    await step('a key the app uses warns, and can be taken anyway (S from "change order")', async () => {
      await setKey(MEMES, 's')
      const conflict = win.getByTestId('key-conflict')
      await conflict.waitFor()
      assert.match(
        await conflict.innerText(),
        /is used for “Order: filename → date → random”\. Use it for memes anyway\?/
      )
      await conflict.getByRole('button', { name: 'Use it' }).click()
      await conflict.waitFor({ state: 'detached' }) // the question is answered before anything else
      await win.waitForFunction(
        async () => (await window.photonic.playlists.list()).find((p) => p.name === 'memes')?.shortcut === 's'
      )
      await shot(win, 'manage-playlists')
      await win.keyboard.press('Escape')
      await manage().waitFor({ state: 'detached' })
    })

    await step('a playlist key marks the photo and moves on; it takes priority over the app key it took', async () => {
      // Unreviewed, by date: new.jpg (EXIF 2019) comes before broken.jpg (file date only)
      await win.keyboard.press('2')
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent.endsWith('/ 2'))
      await win.keyboard.press('Home')
      await waitPath(win, 'new.jpg')
      const sortBefore = await text(win, 'sort')
      await win.keyboard.press('s') // now "put in memes", not "change order"
      await waitPath(win, 'broken.jpg') // next unreviewed
      assert.equal(await text(win, 'sort'), sortBefore)
      const c = await win.evaluate(async () =>
        window.photonic.photos.counts((await window.photonic.libraries.last()).id)
      )
      assert.equal(c.byPlaylist[MEMES], 1)
      await win.keyboard.press('ArrowLeft')
      await waitPath(win, 'new.jpg')
      await win.waitForFunction(() => document.querySelector('[data-testid=status-tag]')?.textContent.includes('MEMES'))
    })

    await step('the ? overlay lists playlist keys and shows the app key that was taken over', async () => {
      await win.keyboard.press('Shift+?')
      const dlg = win.getByRole('dialog', { name: 'Keyboard shortcuts' })
      await dlg.waitFor()
      const t = await dlg.innerText()
      assert.match(t, /memes/)
      assert.match(t, /Order: filename → date → random — now memes/)
      await win.keyboard.press('Escape')
      await dlg.waitFor({ state: 'detached' })
    })

    await step('Reset shortcuts: Like ↑ / Meh ↓ again, clashing keys removed, other keys kept', async () => {
      await openManage()
      await manage().getByRole('button', { name: 'Reset shortcuts' }).click()
      await win.getByTestId('manage-message').waitFor()
      const keys = Object.fromEntries((await playlistsNow()).map((p) => [p.name, p.shortcut]))
      assert.deepEqual(keys, { cats: 'k', Like: 'ArrowUp', Meh: 'ArrowDown', memes: null })
      await win.keyboard.press('Escape')
      await manage().waitFor({ state: 'detached' })
    })

    await step('any playlist key: K puts the photo in cats; the toolbar follows ↑/↓', async () => {
      await win.keyboard.press('2') // Unreviewed: only broken.jpg is left
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 1')
      await waitPath(win, 'broken.jpg')
      await win.keyboard.press('k')
      await win.getByTestId('done-screen').waitFor() // nothing unreviewed left after it
      const c = await win.evaluate(async () =>
        window.photonic.photos.counts((await window.photonic.libraries.last()).id)
      )
      assert.equal(c.byPlaylist[CATS], 1)
      // the scores update as soon as the save returns
      await win.waitForFunction(() => document.querySelector('[data-testid=done-screen]')?.textContent.includes('cats'))
      // the two toolbar buttons are the ↓ and ↑ playlists
      assert.deepEqual(
        await win
          .locator('.toolbar .mark-btn')
          .allInnerTexts()
          .then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())),
        ['¯\\_(ツ)_/¯ Meh ↓', '⸜(｡˃ ᵕ ˂ )⸝♡ Like ↑']
      )
    })

    await step('the Playlists dropdown lists playlists alphabetically; viewing one lets you recategorize', async () => {
      await win.getByTestId('playlists').click()
      const list = win.getByRole('listbox', { name: 'Playlists' })
      await list.waitFor()
      const items = (await list.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
      assert.equal(items[0], 'Manage Playlists…')
      // alphabetically: cats, Like, Meh, memes
      const order = await list
        .locator('[data-testid^=playlist-option-]')
        .evaluateAll((els) => els.map((e) => Number(e.dataset.testid.replace('playlist-option-', ''))))
      assert.deepEqual(order, [CATS, LIKE, MEH, MEMES])
      await shot(win, 'playlists-dropdown')
      await win.getByTestId(`playlist-option-${CATS}`).click()
      await win.waitForFunction(() => document.querySelector('[data-testid=position]')?.textContent === '1 / 1')
      await waitPath(win, 'broken.jpg')
      await win.keyboard.press('ArrowUp') // recategorize: cats → Like
      await win.getByTestId('done-screen').waitFor()
      const c = await counts(win)
      assert.equal(c.like, 2)
    })

    await step('rename a playlist; delete one, choosing where its photos go', async () => {
      await openManage()
      const name = win.getByTestId(`playlist-name-${MEMES}`)
      await name.fill('Funny')
      await win.keyboard.press('Enter')
      await win.waitForFunction(async () => (await window.photonic.playlists.list()).some((p) => p.name === 'Funny'))
      await win.getByTestId(`playlist-row-${MEMES}`).getByRole('button', { name: 'Delete' }).click()
      const confirm = win.getByTestId('delete-confirm')
      await confirm.waitFor()
      assert.match(await confirm.innerText(), /Funny has 1 photo\. Move them to/)
      await win.getByTestId('delete-move-to').selectOption({ label: 'Meh' })
      await confirm.getByRole('button', { name: 'Delete playlist' }).click()
      await confirm.waitFor({ state: 'detached' })
      await win.waitForFunction(async () => !(await window.photonic.playlists.list()).some((p) => p.name === 'Funny'))
      assert.equal(await win.getByTestId(`playlist-row-${LIKE}`).getByRole('button', { name: 'Delete' }).count(), 0) // built in
      await win.keyboard.press('Escape')
      await manage().waitFor({ state: 'detached' })
      assert.equal((await counts(win)).meh, 3) // new.jpg moved from Funny to Meh
    })

    await step(
      'export a playlist: pick a folder, rename with date, copies land flat; originals untouched',
      async () => {
        const out = join(tmp, 'Prints')
        mkdirSync(out)
        writeFileSync(join(out, 'keep-me.txt'), 'x')
        const before = readdirSync(photos, { recursive: true }).sort()
        await stubFolderDialog(app, out)
        await openManage()
        await win.getByTestId(`playlist-row-${MEH}`).getByRole('button', { name: 'Export' }).click()
        const dlg = win.getByRole('dialog', { name: 'Export Meh' })
        await dlg.waitFor()
        await win.waitForFunction((d) => document.querySelector('[data-testid=export-dest]')?.textContent === d, out)
        await win.getByTestId('export-naming-date').check()
        await shot(win, 'export-dialog')
        await dlg.getByRole('button', { name: 'Export' }).click()
        const result = win.getByTestId('export-result')
        await result.waitFor()
        assert.match(await result.innerText(), /Copied 3 photos to/)
        assert.doesNotMatch(await dlg.innerText(), /skipped/) // missing files aren't even tried
        const files = readdirSync(out).sort()
        assert.equal(files.length, 4)
        assert.ok(files.includes('keep-me.txt'))
        for (const f of files.filter((f) => f !== 'keep-me.txt')) assert.match(f, /^\d{8}_\d{6}(_\d+)?\.(jpe?g|png)$/i)
        assert.ok(files.includes('20190704_143210.jpg'), files.join(', ')) // new.jpg's EXIF date
        assert.deepEqual(readdirSync(photos, { recursive: true }).sort(), before)
        await shot(win, 'export-done')
        await win.keyboard.press('Escape') // Done → back to Manage Playlists
        await manage().waitFor()
        await win.keyboard.press('Escape')
        await manage().waitFor({ state: 'detached' })
      }
    )
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
  const dupStats = counts
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
      await win.keyboard.press('3')
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
      await win.keyboard.press('3')
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
          if ((await window.photonic.photos.get(i)).relPath === 'c.jpg') await window.photonic.marks.set(i, 1)
      })
      renameSync(join(dupes, 'c.jpg'), join(dupes, 'c-renamed.jpg'))
      await win.evaluate(async () => window.photonic.libraries.rescan((await window.photonic.libraries.last()).id))
      const s = await stats(win)
      assert.equal(s.missing, 0)
      assert.equal(s.like, 1)
    })

    // ---- Like / Meh a whole folder (F) ----
    const folderDialog = () => win.getByRole('dialog', { name: 'Put a folder in a playlist' })
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
      await win.waitForSelector('text=Put 2 photos in Meh')
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
      await win.waitForSelector('text=Put 2 photos in Like')
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
