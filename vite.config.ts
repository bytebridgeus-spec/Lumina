import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  resolve: {
    // `/src` is resolved against the Vite root, so this needs no node:path
    // and no @types/node. It must stay in step with the `@/*` paths entry in
    // tsconfig.app.json — without it tsc passes but the bundler cannot resolve
    // a single `@/` import.
    alias: { '@': '/src' },
  },
  build: {
    rollupOptions: {
      output: {
        /* Every route is already a dynamic import, so the lazy pages are split.
           What is left in the entry chunk is the framework plus the shell —
           Icons, the store, the seed, the UI primitives — and that came to
           633kB in one file, over the 500kB warning threshold, and it re-downloaded
           on every deploy because its hash moved with any app change.

           Splitting the framework out fixes both: the vendor chunk is stable
           across deploys, and it can be fetched in parallel with the app chunk
           instead of in series with it. The function form (rather than a plain
           object) keeps this working if a dependency is ever added or renamed —
           a hand-written id list goes stale silently, a stale one throws. */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor'
          }
          return undefined
        },
      },
    },
  },
})
