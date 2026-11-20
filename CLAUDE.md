# Photonic — notes for Claude

- Design and decisions: `PLAN.md` (keep its version log and milestone notes current).
- Checks: `npm run typecheck`, `npm test`, `npm run test:e2e` (and `npm run test:e2e:packaged` after `npm run dist`).
- **Running the app for checks or screenshots: always set `PHOTONIC_HIDDEN=1`** (the e2e harness does).
  The window is then never shown, never takes focus and has no Dock icon, but still renders, so
  Playwright can drive it and take screenshots. Also set `PHOTONIC_USER_DATA=<temp dir>` so test
  runs never touch real data. For dev mode: `PHOTONIC_HIDDEN=1 PHOTONIC_USER_DATA=… npx electron-vite dev`,
  and check with `ps` afterwards that it's stopped.
- Native dialogs can't be clicked in tests: stub `dialog.showOpenDialog` via `app.evaluate` (see `tests/e2e/smoke.mjs`).
