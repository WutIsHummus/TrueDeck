import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * monaco-vim (0.4.x) imports deep paths like:
 *   monaco-editor/esm/vs/editor/editor.api
 * Monaco 0.52+ package exports map `./*` → `./esm/vs/*.js`, so that
 * request becomes `./esm/vs/esm/vs/...` and fails. Rewrite legacy paths
 * to the short form that exports expect: monaco-editor/editor/editor.api
 *
 * Also force monaco-vim ESM entry — its package "browser" field points at
 * a UMD build that hits the same broken require.
 */
const monacoVimEsm = resolve('node_modules/monaco-vim/dist/index.mjs')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('electron/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: resolve('src/index.html')
      }
    },
    worker: {
      format: 'es'
    },
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: /^monaco-editor\/esm\/vs\/(.+)$/,
          replacement: 'monaco-editor/$1'
        },
        {
          find: 'monaco-vim',
          replacement: monacoVimEsm
        }
      ]
    },
    optimizeDeps: {
      include: ['monaco-editor', '@monaco-editor/react', 'monaco-vim'],
      esbuildOptions: {
        // Absolute targets so esbuild pre-bundle does not re-hit package exports
        alias: {
          'monaco-editor/esm/vs/editor/editor.api': resolve(
            'node_modules/monaco-editor/esm/vs/editor/editor.api.js'
          ),
          'monaco-editor/esm/vs/editor/common/commands/shiftCommand': resolve(
            'node_modules/monaco-editor/esm/vs/editor/common/commands/shiftCommand.js'
          )
        }
      }
    }
  }
})
