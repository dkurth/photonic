import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PhotonicAPI, ScanProgress } from '@shared/types'

const api: PhotonicAPI = {
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  libraries: {
    pickAndOpen: () => ipcRenderer.invoke('libraries:pickAndOpen'),
    list: () => ipcRenderer.invoke('libraries:list'),
    open: (id) => ipcRenderer.invoke('libraries:open', id),
    last: () => ipcRenderer.invoke('libraries:last'),
    rescan: (id) => ipcRenderer.invoke('libraries:rescan', id),
    stats: (id) => ipcRenderer.invoke('libraries:stats', id),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: ScanProgress): void => cb(p)
      ipcRenderer.on('libraries:progress', listener)
      return () => ipcRenderer.removeListener('libraries:progress', listener)
    }
  },
  photos: {
    listIds: (view) => ipcRenderer.invoke('photos:listIds', view),
    get: (id) => ipcRenderer.invoke('photos:get', id),
    revealInFinder: (id) => ipcRenderer.invoke('photos:revealInFinder', id),
    copyPath: (id) => ipcRenderer.invoke('photos:copyPath', id)
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  onMenu: (cb) => {
    const listener = (_e: IpcRendererEvent, command: string): void => cb(command)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

contextBridge.exposeInMainWorld('photonic', api)
