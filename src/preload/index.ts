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
  }
}

contextBridge.exposeInMainWorld('photonic', api)
