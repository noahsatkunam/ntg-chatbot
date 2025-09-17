import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Production-optimized Vite config for Lovable deployment
export default defineConfig({
  plugins: [
    react({
      // Optimize React for production
      babel: {
        plugins: [
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
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
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React libraries
          'react-vendor': ['react', 'react-dom'],
          // UI component libraries
          'ui-components': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-toast',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select'
          ],
          // Utility libraries
          'utils': ['axios', 'zod', 'clsx', 'class-variance-authority'],
          // Router
          'router': ['react-router-dom'],
          // Form handling
          'forms': ['react-hook-form', '@hookform/resolvers'],
          // Date utilities
          'date-utils': ['date-fns'],
        },
        // Optimize chunk names for caching
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId
            ? chunkInfo.facadeModuleId.split('/').pop().replace(/\.[^/.]+$/, '')
            : 'chunk';
          return `assets/${facadeModuleId}-[hash].js`;
        },
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `assets/images/[name]-[hash][extname]`;
          }
          if (/css/i.test(ext)) {
            return `assets/css/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
      },
      // External dependencies that shouldn't be bundled
      external: [],
    },
    // Optimize chunk size warnings
    chunkSizeWarningLimit: 1000,
    // Ensure proper asset handling
    assetsInlineLimit: 4096,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __DEV__: false,
    'import.meta.env.DEV': false,
    'import.meta.env.PROD': true,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'axios',
      'zod',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
    ],
    exclude: ['@vite/client', '@vite/env'],
  },
  // Ensure proper base path for deployment
  base: './',
  // Production server config (for preview)
  preview: {
    port: 5173,
    strictPort: true,
    host: true,
  },
});
