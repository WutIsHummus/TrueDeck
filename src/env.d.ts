import type { TrueDeckApi } from '../electron/preload/index'

declare global {
  interface Window {
    truedeck: TrueDeckApi
  }
}

export {}
