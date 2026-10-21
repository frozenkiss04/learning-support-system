import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Local dev: Flask backend on :5000. Production uses VITE_API_URL (Render).
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Stable vendor chunks: they change rarely, so browsers/CDNs can
        // cache them across deploys while page chunks stay small.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'data-vendor': ['axios', '@tanstack/react-query', 'zustand'],
        },
      },
    },
  },
})
