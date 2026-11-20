import type { PhotonicAPI } from '../shared/types'

declare global {
  interface Window {
    photonic: PhotonicAPI
  }
}
