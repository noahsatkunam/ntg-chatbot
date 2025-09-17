#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logStep(message) {
  log(`\n${colors.bright}🔧 ${message}${colors.reset}`);
}

class BuildFixer {
  constructor() {
    this.fixes = [];
    this.packageJson = null;
  }

  async fix() {
    log(`${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════════╗
║                     BUILD FIXER                              ║
║              Auto-Fix Build Issues                           ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}`);

    try {
      await this.loadPackageJson();
      await this.fixPackageJson();
      await this.createMissingFiles();
      await this.fixTypeScriptConfig();
      await this.createEnvironmentFiles();
      await this.fixImportIssues();
      await this.installDependencies();
      await this.testBuild();
      
      this.printSummary();
      return true;
    } catch (error) {
      logError(`Build fixing failed: ${error.message}`);
      return false;
    }
  }

  async loadPackageJson() {
    const packagePath = join(projectRoot, 'package.json');
    if (existsSync(packagePath)) {
      this.packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    }
  }

  async fixPackageJson() {
    logStep('Fixing package.json');
    
    if (!this.packageJson) {
      logError('package.json not found');
      return;
    }

    let modified = false;

    // Ensure required scripts exist
    const requiredScripts = {
      'dev': 'vite',
      'build': 'tsc && vite build',
      'build:production': 'cross-env NODE_ENV=production tsc && vite build --mode production',
      'build:lovable': 'cross-env NODE_ENV=production tsc && vite build --mode production --base=./',
      'build:safe': 'npm run type-check && npm run build:lovable',
      'type-check': 'tsc --noEmit',
      'lint': 'eslint . --report-unused-disable-directives --max-warnings 0',
      'preview': 'vite preview',
      'clean': 'rimraf dist node_modules/.vite'
    };

    if (!this.packageJson.scripts) {
      this.packageJson.scripts = {};
      modified = true;
    }

    for (const [script, command] of Object.entries(requiredScripts)) {
      if (!this.packageJson.scripts[script]) {
        this.packageJson.scripts[script] = command;
        this.fixes.push(`Added script: ${script}`);
        modified = true;
      }
    }

    // Ensure engines are specified
    if (!this.packageJson.engines) {
      this.packageJson.engines = {
        "node": ">=18.0.0",
        "npm": ">=9.0.0"
      };
      this.fixes.push('Added Node.js version requirements');
      modified = true;
    }

    // Ensure required dev dependencies
    const requiredDevDeps = {
      'cross-env': '^7.0.3',
      'rimraf': '^5.0.5'
    };

    if (!this.packageJson.devDependencies) {
      this.packageJson.devDependencies = {};
      modified = true;
    }

    for (const [dep, version] of Object.entries(requiredDevDeps)) {
      if (!this.packageJson.devDependencies[dep] && !this.packageJson.dependencies?.[dep]) {
        this.packageJson.devDependencies[dep] = version;
        this.fixes.push(`Added dev dependency: ${dep}`);
        modified = true;
      }
    }

    if (modified) {
      writeFileSync(
        join(projectRoot, 'package.json'),
        JSON.stringify(this.packageJson, null, 2) + '\n'
      );
      logSuccess('Updated package.json');
    } else {
      logSuccess('package.json is already correct');
    }
  }

  async createMissingFiles() {
    logStep('Creating Missing Files');

    const files = [
      {
        path: 'src/vite-env.d.ts',
        content: '/// <reference types="vite/client" />\n'
      },
      {
        path: 'src/types/global.d.ts',
        content: `declare global {
  const __DEV__: boolean;
}

export {};
`
      },
      {
        path: 'public/favicon.ico',
        content: '', // Will be created as empty file
        binary: true
      }
    ];

    for (const file of files) {
      const filePath = join(projectRoot, file.path);
      const dirPath = dirname(filePath);
      
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        this.fixes.push(`Created directory: ${dirname(file.path)}`);
      }
      
      if (!existsSync(filePath)) {
        if (file.binary) {
          // For binary files, just create empty file
          writeFileSync(filePath, '');
        } else {
          writeFileSync(filePath, file.content);
        }
        this.fixes.push(`Created file: ${file.path}`);
        logSuccess(`Created ${file.path}`);
      }
    }
  }

  async fixTypeScriptConfig() {
    logStep('Fixing TypeScript Configuration');

    const tsConfigPath = join(projectRoot, 'tsconfig.json');
    const tsAppConfigPath = join(projectRoot, 'tsconfig.app.json');

    // Create minimal tsconfig.app.json if missing
    if (!existsSync(tsAppConfigPath)) {
      const tsAppConfig = {
        "compilerOptions": {
          "target": "ES2020",
          "useDefineForClassFields": true,
          "lib": ["ES2020", "DOM", "DOM.Iterable"],
          "module": "ESNext",
          "skipLibCheck": true,
          "moduleResolution": "bundler",
          "allowImportingTsExtensions": true,
          "isolatedModules": true,
          "moduleDetection": "force",
          "noEmit": true,
          "jsx": "react-jsx",
          "strict": false,
          "noUnusedLocals": false,
          "noUnusedParameters": false,
          "noImplicitAny": false,
          "noFallthroughCasesInSwitch": false,
          "baseUrl": ".",
          "paths": {
            "@/*": ["./src/*"]
          }
        },
        "include": ["src"]
      };

      writeFileSync(tsAppConfigPath, JSON.stringify(tsAppConfig, null, 2) + '\n');
      this.fixes.push('Created tsconfig.app.json');
      logSuccess('Created tsconfig.app.json');
    }

    // Ensure main tsconfig.json references app config
    if (existsSync(tsConfigPath)) {
      const tsConfig = JSON.parse(readFileSync(tsConfigPath, 'utf8'));
      let modified = false;

      if (!tsConfig.references) {
        tsConfig.references = [
          { "path": "./tsconfig.app.json" },
          { "path": "./tsconfig.node.json" }
        ];
        modified = true;
      }

      if (!tsConfig.files) {
        tsConfig.files = [];
        modified = true;
      }

      if (modified) {
        writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2) + '\n');
        this.fixes.push('Updated tsconfig.json');
        logSuccess('Updated tsconfig.json');
      }
    }
  }

  async createEnvironmentFiles() {
    logStep('Creating Environment Files');

    const envFiles = [
      {
        name: '.env.production',
        content: `# Production Environment Variables for Lovable Preview
# API Configuration - Lovable compatible URLs
VITE_API_URL=/api
VITE_WS_URL=
VITE_PORT=5173

# Authentication - Disabled for Lovable preview
VITE_AUTH_REDIRECT_URL=/auth/callback
VITE_ENABLE_AUTH=false
VITE_MOCK_AUTH=true

# File Upload Configuration
VITE_MAX_FILE_SIZE=52428800
VITE_ALLOWED_FILE_TYPES=.pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif

# Chat Configuration
VITE_CHAT_MODEL=gpt-4
VITE_CHAT_MAX_TOKENS=4000
VITE_CHAT_TEMPERATURE=0.7

# Feature Flags - Optimized for Lovable
VITE_ENABLE_STREAMING=false
VITE_ENABLE_FILE_UPLOAD=true
VITE_ENABLE_ANALYTICS=false
VITE_ENABLE_WORKFLOWS=false
VITE_ENABLE_2FA=false
VITE_ENABLE_MOCK_DATA=true

# Development Flags
VITE_ENABLE_DEV_TOOLS=false
VITE_ENABLE_DEBUG=false
VITE_MOCK_BACKEND=true

# Security - Relaxed for Lovable preview
VITE_ENABLE_CSP=false
VITE_ENABLE_HTTPS_ONLY=false

# Lovable Specific
VITE_PREVIEW_MODE=true
VITE_LOVABLE_PREVIEW=true
VITE_BASE_URL=./
`
      },
      {
        name: '.env.lovable',
        content: `# Minimal environment for Lovable builds
VITE_API_URL=/api
VITE_MOCK_BACKEND=true
VITE_ENABLE_AUTH=false
VITE_PREVIEW_MODE=true
VITE_LOVABLE_PREVIEW=true
`
      }
    ];

    for (const envFile of envFiles) {
      const envPath = join(projectRoot, envFile.name);
      if (!existsSync(envPath)) {
        writeFileSync(envPath, envFile.content);
        this.fixes.push(`Created ${envFile.name}`);
        logSuccess(`Created ${envFile.name}`);
      }
    }
  }

  async fixImportIssues() {
    logStep('Fixing Common Import Issues');

    // Check if main.tsx exists and has correct imports
    const mainTsxPath = join(projectRoot, 'src/main.tsx');
    if (existsSync(mainTsxPath)) {
      let content = readFileSync(mainTsxPath, 'utf8');
      let modified = false;

      // Ensure React imports are correct
      if (!content.includes("import React from 'react'") && !content.includes("import { StrictMode }")) {
        content = `import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\n${content}`;
        modified = true;
      }

      // Ensure proper root mounting
      if (!content.includes('createRoot') && content.includes('ReactDOM.render')) {
        content = content.replace(
          /ReactDOM\.render\((.*?),\s*document\.getElementById\('root'\)\)/s,
          "createRoot(document.getElementById('root')!).render($1)"
        );
        modified = true;
      }

      if (modified) {
        writeFileSync(mainTsxPath, content);
        this.fixes.push('Fixed main.tsx imports');
        logSuccess('Fixed main.tsx imports');
      }
    }
  }

  async installDependencies() {
    logStep('Installing Dependencies');

    try {
      execSync('npm install', { 
        cwd: projectRoot, 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      this.fixes.push('Installed dependencies');
      logSuccess('Dependencies installed successfully');
    } catch (error) {
      logError('Failed to install dependencies');
      logError(error.stdout || error.message);
    }
  }

  async testBuild() {
    logStep('Testing Build Process');

    try {
      // Test TypeScript compilation
      execSync('npm run type-check', { 
        cwd: projectRoot, 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      logSuccess('TypeScript compilation successful');
    } catch (error) {
      logWarning('TypeScript compilation has issues');
      logWarning(error.stdout || error.message);
    }

    try {
      // Test build
      execSync('npm run build:safe', { 
        cwd: projectRoot, 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      this.fixes.push('Build process verified');
      logSuccess('Build process successful');
    } catch (error) {
      logError('Build process failed');
      logError(error.stdout || error.message);
    }
  }

  printSummary() {
    log(`\n${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`);
    log(`${colors.bright}                         FIX SUMMARY${colors.reset}`);
    log(`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`);
    
    if (this.fixes.length === 0) {
      logInfo('No fixes were needed - build was already healthy!');
    } else {
      log(`\n${colors.green}${colors.bright}FIXES APPLIED (${this.fixes.length}):${colors.reset}`);
      this.fixes.forEach((fix, index) => {
        log(`${colors.green}  ${index + 1}. ${fix}${colors.reset}`);
      });
      
      logSuccess('\n🎉 Build fixes completed successfully!');
    }
    
    log(`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}\n`);
  }
}

// Run fixer if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixer = new BuildFixer();
  const success = await fixer.fix();
  process.exit(success ? 0 : 1);
}

export default BuildFixer;
