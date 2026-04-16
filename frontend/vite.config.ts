import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Comma-separated list of extra hosts (e.g. a tunnel subdomain) Vite should accept
// in dev mode. Set VITE_ALLOWED_HOSTS in .env, e.g. "terminal.example.com,other.example.com".
const extraHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map(h => h.trim())
  .filter(Boolean);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: extraHosts.length > 0 ? extraHosts : undefined,
    proxy: {
      '/api': 'http://localhost:3002',
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
})
