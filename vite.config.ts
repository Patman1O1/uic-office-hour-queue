import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Node/Socket.io server (server/index.ts) runs on 3001 during development.
const API = `http://localhost:${process.env.PORT ?? 3001}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the LAN too, so phones on the same Wi-Fi can open the QR link.
    host: true,
    proxy: {
      '/socket.io': { target: API, ws: true },
      '/api': API,
    },
  },
})
