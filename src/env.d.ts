/// <reference types="vite/client" />

import type { TrueDeckApi } from '../electron/preload/index'

declare global {
  interface Window {
    truedeck: TrueDeckApi
    /** Sync session/layout flush for main-process close handler */
    __truedeckFlushSessions?: () => void
  }
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

/** Vite worker imports used by Monaco */
declare module '*?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}

export {}
