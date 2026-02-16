import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm'],
          ui: ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Proxy API requests to the backend server — API keys never touch the client
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Suppress noisy ECONNREFUSED errors during startup (backend may not be ready yet)
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (!res.headersSent && 'writeHead' in res) {
              (res as import('http').ServerResponse).writeHead(502, { 'Content-Type': 'application/json' });
              (res as import('http').ServerResponse).end(JSON.stringify({ error: 'Backend not available yet' }));
            }
          });
        },
      },
    },
  },
  plugins: [react()],
  // REMOVED: API key injection into the client bundle. 
  // Keys are now securely handled by the backend server only.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
