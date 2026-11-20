import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from 'electron'

function send(command: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu', command)
}

export interface MenuOptions {
  /** Whether the optional dedupe feature is on (PLAN.md §8). */
  dedupe: boolean
  setDedupe: (on: boolean) => void
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
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send('open-folder') },
        { label: 'Rescan Folder', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('rescan') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Standard edit roles keep copy/paste working in text fields (e.g. the folder search).
    { role: 'editMenu' },
    {
      label: 'Library',
      submenu: [
        { label: 'Go to Folder…', accelerator: 'G', registerAccelerator: false, click: () => send('go-to-folder') },
        { type: 'separator' },
        { label: 'Hide Duplicates…', enabled: opts.dedupe, click: () => send('hide-duplicates') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
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
