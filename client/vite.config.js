import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: true, // listens on 0.0.0.0 so a phone on the LAN can open the dev server
    port: 5173,
    allowedHosts: true, // LAN IPs in the Host header
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/socket.io': {
        target: 'http://127.0.0.1:8787',
        ws: true,
        changeOrigin: false,
      },
    },
  },
})
