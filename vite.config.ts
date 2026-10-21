import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API runs separately (npm run dev:api) and Vite forwards /api to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': `http://localhost:${process.env.API_PORT || 8787}` } },
})
