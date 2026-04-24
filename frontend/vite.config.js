import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // allow external access
    port: 5173, // optional (your dev port)
    strictPort: true,
    allowedHosts: [
      'delphia-synostotic-fletcher.ngrok-free.dev'
    ]
  }
})