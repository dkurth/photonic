import { contextBridge, ipcRenderer } from 'electron'
import type { PhotonicAPI } from '@shared/types'

const api: PhotonicAPI = {
  app: {
    info: () => ipcRenderer.invoke('app:info')
  }
}

contextBridge.exposeInMainWorld('photonic', api)
