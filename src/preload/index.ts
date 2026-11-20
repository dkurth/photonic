import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PhotonicAPI, ScanProgress, UiSettings } from '@shared/types'

/** Subscribes to a main → renderer event; returns an unsubscribe function. */
function on<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PhotonicAPI = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    toggleFullScreen: () => ipcRenderer.invoke('app:toggleFullScreen'),
    isFullScreen: () => ipcRenderer.invoke('app:isFullScreen'),
    onFullScreen: (cb) => on<boolean>('fullscreen', cb),
    ui: () => ipcRenderer.invoke('app:ui'),
    onUiChanged: (cb) => on<UiSettings>('ui:changed', cb)
  },
  libraries: {
    pickAndOpen: () => ipcRenderer.invoke('libraries:pickAndOpen'),
    list: () => ipcRenderer.invoke('libraries:list'),
    open: (id) => ipcRenderer.invoke('libraries:open', id),
    last: () => ipcRenderer.invoke('libraries:last'),
    rescan: (id) => ipcRenderer.invoke('libraries:rescan', id),
    stats: (id) => ipcRenderer.invoke('libraries:stats', id),
    folders: (id) => ipcRenderer.invoke('libraries:folders', id),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: ScanProgress): void => cb(p)
      ipcRenderer.on('libraries:progress', listener)
      return () => ipcRenderer.removeListener('libraries:progress', listener)
    }
  },
  photos: {
    listIds: (view) => ipcRenderer.invoke('photos:listIds', view),
    list: (view) => ipcRenderer.invoke('photos:list', view),
    counts: (libraryId, scope) => ipcRenderer.invoke('photos:counts', libraryId, scope),
    get: (id) => ipcRenderer.invoke('photos:get', id),
    revealInFinder: (id) => ipcRenderer.invoke('photos:revealInFinder', id),
    copyPath: (id) => ipcRenderer.invoke('photos:copyPath', id)
  },
  marks: {
    set: (photoId, status) => ipcRenderer.invoke('marks:set', photoId, status),
    undo: (libraryId) => ipcRenderer.invoke('marks:undo', libraryId)
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  features: {
    enabled: () => ipcRenderer.invoke('features:enabled')
  },
  duplicates: {
    summary: (libraryId) => ipcRenderer.invoke('duplicates:summary', libraryId),
    copies: (photoId) => ipcRenderer.invoke('duplicates:copies', photoId),
    previewHide: (libraryId) => ipcRenderer.invoke('duplicates:previewHide', libraryId),
    hide: (libraryId) => ipcRenderer.invoke('duplicates:hide', libraryId)
  },
  onMenu: (cb) => {
    const listener = (_e: IpcRendererEvent, command: string): void => cb(command)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

contextBridge.exposeInMainWorld('photonic', api)
