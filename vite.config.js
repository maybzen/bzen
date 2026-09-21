import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 처럼 하위 경로(/repo/)에 배포할 때 VITE_BASE 로 지정합니다.
// 예) VITE_BASE=/bizen-accounting/
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    open: false,
  },
})
