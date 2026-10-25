// Vite configuration.
// The proxy forwards every request starting with /api to the Flask backend,
// so the React code can simply call fetch('/api/...') with no CORS issues.
// `npm run dev:lan` (mode "lan") serves over HTTPS with a self-signed certificate:
// phones only give a web page their step/compass sensors on a secure (https) page.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'lan' && basicSsl()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
}))
