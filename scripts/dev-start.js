#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logService(service, message, color = colors.reset) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.bright}[${timestamp}]${colors.reset} ${color}[${service}]${colors.reset} ${message}`);
}

// Check if .env.local exists
function checkEnvironment() {
  const envLocalPath = join(rootDir, '.env.local');
  if (!fs.existsSync(envLocalPath)) {
    log('❌ .env.local file not found!', colors.red);
    log('Please copy .env.local from the root directory or create one for local development.', colors.yellow);
    process.exit(1);
  }
  log('✅ Found .env.local configuration', colors.green);
}

// Setup SQLite database
async function setupDatabase() {
  log('\n🔧 Setting up SQLite database...', colors.cyan);
  
  const backendDir = join(rootDir, 'backend');
  
  return new Promise((resolve, reject) => {
    const setupProcess = spawn('npm', ['run', 'db:setup'], {
      cwd: backendDir,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, NODE_ENV: 'development' }
    });

    setupProcess.stdout.on('data', (data) => {
      logService('DB-SETUP', data.toString().trim(), colors.cyan);
    });

    setupProcess.stderr.on('data', (data) => {
      logService('DB-SETUP', data.toString().trim(), colors.yellow);
    });

    setupProcess.on('close', (code) => {
      if (code === 0) {
        log('✅ Database setup completed', colors.green);
        resolve();
      } else {
        log('❌ Database setup failed', colors.red);
        reject(new Error(`Database setup failed with code ${code}`));
      }
    });
  });
}

// Start backend server
function startBackend() {
  log('\n🚀 Starting backend server...', colors.blue);
  
  const backendDir = join(rootDir, 'backend');
  const backendProcess = spawn('npm', ['run', 'dev'], {
    cwd: backendDir,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' }
  });

  backendProcess.stdout.on('data', (data) => {
    logService('BACKEND', data.toString().trim(), colors.blue);
  });

  backendProcess.stderr.on('data', (data) => {
    logService('BACKEND', data.toString().trim(), colors.yellow);
  });

  backendProcess.on('close', (code) => {
    logService('BACKEND', `Process exited with code ${code}`, colors.red);
  });

  return backendProcess;
}

// Start frontend server
function startFrontend() {
  log('\n🎨 Starting frontend server...', colors.magenta);
  
  const frontendDir = join(rootDir, 'frontend');
  const frontendProcess = spawn('npm', ['run', 'dev'], {
    cwd: frontendDir,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' }
  });

  frontendProcess.stdout.on('data', (data) => {
    logService('FRONTEND', data.toString().trim(), colors.magenta);
  });

  frontendProcess.stderr.on('data', (data) => {
    logService('FRONTEND', data.toString().trim(), colors.yellow);
  });

  frontendProcess.on('close', (code) => {
    logService('FRONTEND', `Process exited with code ${code}`, colors.red);
  });

  return frontendProcess;
}

// Main function
async function main() {
  log('🏗️  Starting NTG Chatbot Local Development Environment', colors.bright);
  log('=' .repeat(60), colors.bright);

  try {
    // Check environment
    checkEnvironment();

    // Setup database
    await setupDatabase();

    // Start services
    const backendProcess = startBackend();
    const frontendProcess = startFrontend();

    // Wait a bit for services to start
    setTimeout(() => {
      log('\n' + '='.repeat(60), colors.bright);
      log('🎉 Development environment is starting up!', colors.green);
      log('', colors.reset);
      log('📍 Services:', colors.bright);
      log('   • Backend API: http://localhost:3001', colors.blue);
      log('   • Frontend App: http://localhost:5173', colors.magenta);
      log('   • Health Check: http://localhost:3001/api/health', colors.cyan);
      log('', colors.reset);
      log('💡 Tips:', colors.bright);
      log('   • Press Ctrl+C to stop all services', colors.yellow);
      log('   • Check logs above for any startup issues', colors.yellow);
      log('   • Database is SQLite (./backend/dev.db)', colors.yellow);
      log('   • All external services are mocked for local development', colors.yellow);
      log('=' .repeat(60), colors.bright);
    }, 3000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('\n\n🛑 Shutting down development environment...', colors.yellow);
      
      backendProcess.kill('SIGTERM');
      frontendProcess.kill('SIGTERM');
      
      setTimeout(() => {
        backendProcess.kill('SIGKILL');
        frontendProcess.kill('SIGKILL');
        process.exit(0);
      }, 5000);
    });

    process.on('SIGTERM', () => {
      backendProcess.kill('SIGTERM');
      frontendProcess.kill('SIGTERM');
      process.exit(0);
    });

  } catch (error) {
    log(`❌ Failed to start development environment: ${error.message}`, colors.red);
    process.exit(1);
  }
}

main().catch(console.error);
