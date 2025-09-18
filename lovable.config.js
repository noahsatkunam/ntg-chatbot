// Lovable deployment configuration for monorepo (frontend workspace)
export default {
  // Build configuration (runs in the frontend workspace)
  build: {
    command: 'sh -c "npm --prefix frontend install --ignore-scripts --no-audit --fund=false && npm --prefix frontend run build:lovable"',
    directory: 'frontend/dist',
    environment: {
      NODE_VERSION: '18',
      NPM_VERSION: '9',
      NODE_ENV: 'production'
    }
  },

  // Development configuration (use Vite dev server from frontend)
  dev: {
    command: 'sh -c "npm --prefix frontend install --ignore-scripts --no-audit --fund=false && npm --prefix frontend run dev"',
    port: 5173
  },

  // Routing configuration for SPA
  redirects: [
    {
      from: '/*',
      to: '/index.html',
      status: 200
    }
  ],

  // Headers for optimization
  headers: [
    {
      source: '/assets/*',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    },
    {
      source: '*.js',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    },
    {
      source: '*.css',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    },
    {
      source: '/index.html',
      headers: {
        'Cache-Control': 'public, max-age=0, must-revalidate'
      }
    }
  ],

  // Environment variables for Lovable
  env: {
    VITE_PREVIEW_MODE: 'true',
    VITE_LOVABLE_PREVIEW: 'true',
    VITE_MOCK_BACKEND: 'true',
    VITE_ENABLE_AUTH: 'false'
  }
};
