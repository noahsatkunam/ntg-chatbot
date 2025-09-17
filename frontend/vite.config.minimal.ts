import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Minimal Vite config for bulletproof builds
export default defineConfig({
  plugins: [
    react({
      // Minimal React configuration
      babel: {
        plugins: []
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
    sourcemap: false,
    minify: 'esbuild', // Faster than terser, more reliable
    target: 'es2015', // Broader compatibility
    rollupOptions: {
      output: {
        // Simple chunking strategy
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'utils': ['axios', 'zod']
        },
        // Simple file naming
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
      // Handle potential issues
      onwarn(warning, warn) {
        // Suppress common warnings that don't affect builds
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        if (warning.code === 'SOURCEMAP_ERROR') return;
        warn(warning);
      }
    },
    // Conservative settings
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 2048,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __DEV__: false,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom'
    ],
    exclude: []
  },
  // Ensure proper base path
  base: './',
  // Simple server config
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  preview: {
    port: 5173,
    strictPort: false,
    host: true,
  },
});
