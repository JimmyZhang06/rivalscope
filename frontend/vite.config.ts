import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // 监听 0.0.0.0，允许局域网内其他设备通过本机 IP 访问
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-editor': ['react-markdown', 'remark-gfm'],
          'vendor-pdf': ['html2pdf.js'],
          'vendor-flow': ['reactflow'],
          'vendor-state': ['zustand', 'zustand/middleware'],
          'vendor-utils': ['zod'],
        },
      },
    },
    sourcemap: false,
    chunkSizeWarningLimit: 500,
  },
})
