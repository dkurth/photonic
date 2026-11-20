import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import type { Appearance, UiSettings } from '@shared/types'
import { PALETTES, type PaletteId } from '@shared/palettes'

function send(command: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu', command)
}

export interface MenuOptions {
  /** Whether the optional dedupe feature is on (PLAN.md §8). */
  dedupe: boolean
  setDedupe: (on: boolean) => void
  ui: () => UiSettings
  setUi: (patch: Partial<UiSettings>) => void
}

async function toggleDedupe(opts: MenuOptions): Promise<void> {
  const on = !opts.dedupe
  opts.setDedupe(on)
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `Duplicate detection will be turned ${on ? 'on' : 'off'} after a restart.`,
    detail: on
      ? 'Photos will be hashed in the background to find identical copies.'
      : 'Your Like/Meh marks are not affected.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) {
    app.relaunch()
    app.quit()
  }
}

/** The app menu. Items that act on the UI send a command to the renderer. */
export function buildMenu(opts: MenuOptions): void {
  const isMac = process.platform === 'darwin'
  const ui = opts.ui()
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send('open-folder') },
        { label: 'Switch Library…', accelerator: 'CmdOrCtrl+L', click: () => send('switch-library') },
        { label: 'Rescan Folder', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('rescan') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Undo is the app's own (marks); the page decides whether a text field should get it instead.
    // Cut/copy/paste roles keep text fields (e.g. the folder search) working.
    {
      label: 'Edit',
      submenu: [
        { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Library',
      submenu: [{ label: 'Hide Duplicates…', enabled: opts.dedupe, click: () => send('hide-duplicates') }]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'Shift+/',
          registerAccelerator: false,
          click: () => send('shortcuts')
        },
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: (Object.keys(PALETTES) as PaletteId[]).map((id) => ({
            id: `theme-${id}`,
            label: PALETTES[id].name,
            type: 'radio' as const,
            checked: ui.theme === id,
            click: () => opts.setUi({ theme: id })
          }))
        },
        {
          label: 'Appearance',
          submenu: (['system', 'light', 'dark'] as Appearance[]).map((a) => ({
            id: `appearance-${a}`,
            label: a === 'system' ? 'Match System' : a === 'light' ? 'Light' : 'Dark',
            type: 'radio' as const,
            checked: ui.appearance === a,
            click: () => opts.setUi({ appearance: a })
          }))
        },
        {
          id: 'animations',
          label: 'Animations',
          type: 'checkbox',
          checked: ui.animations,
          click: () => opts.setUi({ animations: !ui.animations })
        },
        { type: 'separator' },
        {
          label: 'Duplicate Detection',
          type: 'checkbox',
          checked: opts.dedupe,
          click: () => void toggleDedupe(opts)
        },
        ...(!app.isPackaged
          ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
