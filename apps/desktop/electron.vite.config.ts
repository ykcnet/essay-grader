import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// core 以原始碼形式被三個行程共用，因此不列入 externalize，交給 Vite 打包。
const coreAlias = {
  '@essay-grader/core/constants': resolve('../../packages/core/src/constants.ts'),
  '@essay-grader/core/review': resolve('../../packages/core/src/review.ts'),
  '@essay-grader/core': resolve('../../packages/core/src/index.ts')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: coreAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: coreAlias }
  },
  renderer: {
    resolve: {
      alias: {
        ...coreAlias,
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          spike: resolve('src/renderer/spike.html'),
          feedback: resolve('src/renderer/feedback.html')
        }
      }
    },
    plugins: [react()]
  }
})
