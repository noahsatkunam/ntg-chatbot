import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    base: mode === 'production' ? './' : '/',
    server: {
      host: true,
      port: parseInt(env.VITE_PORT) || 5173,
    },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'NTG Chatbot Platform',
        short_name: 'NTG Chatbot',
        description: 'Enterprise AI Chatbot Platform with Knowledge Base and Workflows',
        theme_color: '#0f172a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      base: mode === 'production' ? './' : '/',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-toast'],
            utils: ['axios', 'socket.io-client', 'zod'],
            router: ['react-router-dom'],
          },
        },
      },
      sourcemap: command === 'serve',
      minify: mode === 'production' ? 'terser' : false,
      terserOptions: mode === 'production' ? {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      } : undefined,
      chunkSizeWarningLimit: 1000,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      __DEV__: mode === 'development',
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'axios', 'socket.io-client'],
    },
  };
});
