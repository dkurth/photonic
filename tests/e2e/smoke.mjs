// End-to-end smoke test: launches the *built* app with a throwaway data dir and checks that it
// starts, migrates, backs up, and renders. Run with `npm run test:e2e` (builds first).
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'

const userData = mkdtempSync(join(tmpdir(), 'photonic-e2e-'))
try {
  for (const run of [1, 2]) {
    const app = await _electron.launch({ args: ['.'], env: { ...process.env, PHOTONIC_USER_DATA: userData } })
    const win = await app.firstWindow()
    await win.waitForSelector('dl', { timeout: 10_000 })
    const text = await win.locator('main').innerText()
    assert.match(text, /PHOTONIC/)
    assert.match(text, /v1/)
    assert.equal(await win.evaluate(() => typeof require), 'undefined', 'renderer must not have Node')
    await app.close()
    console.log(`run ${run}: ok`)
  }
  assert.ok(readdirSync(userData).includes('photonic.db'))
  assert.equal(readdirSync(join(userData, 'backups')).length, 1, 'second launch within 24h must not back up again')
  console.log('e2e smoke: passed')
} finally {
  rmSync(userData, { recursive: true, force: true })
}
