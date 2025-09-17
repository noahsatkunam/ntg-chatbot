#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
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
  log(`\n${colors.bright}🔍 ${message}${colors.reset}`);
}

class BuildValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.packageJson = null;
    this.tsConfig = null;
  }

  async validate() {
    log(`${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════════╗
║                    BUILD VALIDATOR                           ║
║              NTG Chatbot Frontend                            ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}`);

    try {
      await this.checkProjectStructure();
      await this.checkPackageJson();
      await this.checkDependencies();
      await this.checkTypeScriptConfig();
      await this.checkEnvironmentFiles();
      await this.checkSourceFiles();
      await this.validateTypeScript();
      await this.validateBuild();
      await this.checkBuildOutput();
      
      this.printSummary();
      return this.errors.length === 0;
    } catch (error) {
      logError(`Validation failed: ${error.message}`);
      return false;
    }
  }

  async checkProjectStructure() {
    logStep('Checking Project Structure');
    
    const requiredFiles = [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'src/main.tsx',
      'src/App.tsx',
      'index.html'
    ];

    const requiredDirs = [
      'src',
      'src/components',
      'src/lib',
      'public'
    ];

    for (const file of requiredFiles) {
      const filePath = join(projectRoot, file);
      if (existsSync(filePath)) {
        logSuccess(`Found ${file}`);
      } else {
        this.errors.push(`Missing required file: ${file}`);
        logError(`Missing ${file}`);
      }
    }

    for (const dir of requiredDirs) {
      const dirPath = join(projectRoot, dir);
      if (existsSync(dirPath)) {
        logSuccess(`Found directory ${dir}`);
      } else {
        this.warnings.push(`Missing directory: ${dir}`);
        logWarning(`Missing directory ${dir}`);
      }
    }
  }

  async checkPackageJson() {
    logStep('Validating package.json');
    
    const packagePath = join(projectRoot, 'package.json');
    if (!existsSync(packagePath)) {
      this.errors.push('package.json not found');
      return;
    }

    try {
      this.packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
      
      // Check required fields
      const requiredFields = ['name', 'version', 'scripts', 'dependencies'];
      for (const field of requiredFields) {
        if (this.packageJson[field]) {
          logSuccess(`package.json has ${field}`);
        } else {
          this.errors.push(`package.json missing ${field}`);
          logError(`Missing ${field} in package.json`);
        }
      }

      // Check required scripts
      const requiredScripts = ['dev', 'build', 'build:lovable'];
      for (const script of requiredScripts) {
        if (this.packageJson.scripts?.[script]) {
          logSuccess(`Found script: ${script}`);
        } else {
          this.errors.push(`Missing script: ${script}`);
          logError(`Missing script: ${script}`);
        }
      }

      // Check Node.js version requirement
      if (this.packageJson.engines?.node) {
        logSuccess(`Node.js version specified: ${this.packageJson.engines.node}`);
      } else {
        this.warnings.push('No Node.js version specified in engines');
        logWarning('No Node.js version specified');
      }

    } catch (error) {
      this.errors.push(`Invalid package.json: ${error.message}`);
      logError(`Invalid package.json: ${error.message}`);
    }
  }

  async checkDependencies() {
    logStep('Checking Dependencies');
    
    if (!this.packageJson) return;

    const criticalDeps = [
      'react',
      'react-dom',
      'vite',
      'typescript',
      '@vitejs/plugin-react'
    ];

    for (const dep of criticalDeps) {
      if (this.packageJson.dependencies?.[dep] || this.packageJson.devDependencies?.[dep]) {
        logSuccess(`Found dependency: ${dep}`);
      } else {
        this.errors.push(`Missing critical dependency: ${dep}`);
        logError(`Missing dependency: ${dep}`);
      }
    }

    // Check for node_modules
    const nodeModulesPath = join(projectRoot, 'node_modules');
    if (existsSync(nodeModulesPath)) {
      logSuccess('node_modules directory exists');
      
      // Check if critical packages are installed
      for (const dep of criticalDeps) {
        const depPath = join(nodeModulesPath, dep);
        if (existsSync(depPath)) {
          logSuccess(`${dep} is installed`);
        } else {
          this.warnings.push(`${dep} not found in node_modules`);
          logWarning(`${dep} not installed`);
        }
      }
    } else {
      this.errors.push('node_modules not found - run npm install');
      logError('node_modules not found');
    }
  }

  async checkTypeScriptConfig() {
    logStep('Checking TypeScript Configuration');
    
    const tsConfigPath = join(projectRoot, 'tsconfig.json');
    if (!existsSync(tsConfigPath)) {
      this.errors.push('tsconfig.json not found');
      return;
    }

    try {
      this.tsConfig = JSON.parse(readFileSync(tsConfigPath, 'utf8'));
      logSuccess('tsconfig.json is valid JSON');

      // Check for app-specific config
      const tsAppConfigPath = join(projectRoot, 'tsconfig.app.json');
      if (existsSync(tsAppConfigPath)) {
        logSuccess('Found tsconfig.app.json');
      } else {
        this.warnings.push('tsconfig.app.json not found');
        logWarning('tsconfig.app.json not found');
      }

    } catch (error) {
      this.errors.push(`Invalid tsconfig.json: ${error.message}`);
      logError(`Invalid tsconfig.json: ${error.message}`);
    }
  }

  async checkEnvironmentFiles() {
    logStep('Checking Environment Configuration');
    
    const envFiles = [
      '.env.example',
      '.env.production',
      '.env.lovable'
    ];

    for (const envFile of envFiles) {
      const envPath = join(projectRoot, envFile);
      if (existsSync(envPath)) {
        logSuccess(`Found ${envFile}`);
        
        // Check if file has content
        const content = readFileSync(envPath, 'utf8');
        if (content.trim().length > 0) {
          logSuccess(`${envFile} has content`);
        } else {
          this.warnings.push(`${envFile} is empty`);
          logWarning(`${envFile} is empty`);
        }
      } else {
        this.warnings.push(`Missing ${envFile}`);
        logWarning(`Missing ${envFile}`);
      }
    }
  }

  async checkSourceFiles() {
    logStep('Checking Source Files');
    
    const criticalFiles = [
      'src/main.tsx',
      'src/App.tsx',
      'src/index.css',
      'index.html'
    ];

    for (const file of criticalFiles) {
      const filePath = join(projectRoot, file);
      if (existsSync(filePath)) {
        const stats = statSync(filePath);
        if (stats.size > 0) {
          logSuccess(`${file} exists and has content`);
        } else {
          this.warnings.push(`${file} is empty`);
          logWarning(`${file} is empty`);
        }
      } else {
        this.errors.push(`Missing critical file: ${file}`);
        logError(`Missing ${file}`);
      }
    }
  }

  async validateTypeScript() {
    logStep('Validating TypeScript Compilation');
    
    try {
      execSync('npx tsc --noEmit', { 
        cwd: projectRoot, 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      logSuccess('TypeScript compilation successful');
    } catch (error) {
      this.errors.push('TypeScript compilation failed');
      logError('TypeScript compilation failed');
      logError(error.stdout || error.message);
    }
  }

  async validateBuild() {
    logStep('Testing Build Process');
    
    try {
      // Clean previous build
      execSync('npm run clean', { 
        cwd: projectRoot, 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      logSuccess('Cleaned previous build');
    } catch (error) {
      logWarning('Clean command failed (may not exist)');
    }

    try {
      // Test build
      execSync('npm run build:lovable', { 
        cwd: projectRoot, 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      logSuccess('Build process completed successfully');
    } catch (error) {
      this.errors.push('Build process failed');
      logError('Build process failed');
      logError(error.stdout || error.message);
    }
  }

  async checkBuildOutput() {
    logStep('Validating Build Output');
    
    const distPath = join(projectRoot, 'dist');
    if (!existsSync(distPath)) {
      this.errors.push('Build output directory (dist) not found');
      logError('dist directory not found');
      return;
    }

    const requiredBuildFiles = [
      'index.html',
      'assets'
    ];

    for (const file of requiredBuildFiles) {
      const filePath = join(distPath, file);
      if (existsSync(filePath)) {
        logSuccess(`Build output contains ${file}`);
      } else {
        this.errors.push(`Missing in build output: ${file}`);
        logError(`Missing in build output: ${file}`);
      }
    }

    // Check index.html content
    const indexPath = join(distPath, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath, 'utf8');
      if (content.includes('<div id="root">')) {
        logSuccess('index.html contains React root element');
      } else {
        this.warnings.push('index.html may be missing React root element');
        logWarning('index.html may be missing React root element');
      }
    }
  }

  printSummary() {
    log(`\n${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`);
    log(`${colors.bright}                        VALIDATION SUMMARY${colors.reset}`);
    log(`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`);
    
    if (this.errors.length === 0 && this.warnings.length === 0) {
      logSuccess('🎉 All checks passed! Build is ready for deployment.');
    } else {
      if (this.errors.length > 0) {
        log(`\n${colors.red}${colors.bright}ERRORS (${this.errors.length}):${colors.reset}`);
        this.errors.forEach((error, index) => {
          log(`${colors.red}  ${index + 1}. ${error}${colors.reset}`);
        });
      }
      
      if (this.warnings.length > 0) {
        log(`\n${colors.yellow}${colors.bright}WARNINGS (${this.warnings.length}):${colors.reset}`);
        this.warnings.forEach((warning, index) => {
          log(`${colors.yellow}  ${index + 1}. ${warning}${colors.reset}`);
        });
      }
      
      if (this.errors.length === 0) {
        logSuccess('\n✅ Build validation passed with warnings.');
        logInfo('Warnings should be addressed but won\'t prevent deployment.');
      } else {
        logError('\n❌ Build validation failed.');
        logError('Please fix the errors above before deploying.');
      }
    }
    
    log(`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}\n`);
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new BuildValidator();
  const success = await validator.validate();
  process.exit(success ? 0 : 1);
}

export default BuildValidator;
