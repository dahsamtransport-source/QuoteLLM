import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localApi } from './local-api'

export default defineConfig({
  plugins: [react(), localApi()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
