// Vite configuration.
// The proxy forwards every request starting with /api to the Flask backend,
// so the React code can simply call fetch('/api/...') with no CORS issues.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
})
