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

// Service configurations
const services = [
  {
    name: 'N8N',
    command: 'n8n',
    args: ['start', '--env-file=.env.n8n'],
    cwd: rootDir,
    color: colors.blue,
    port: 5678,
    healthUrl: 'http://localhost:5678/healthz'
  },
  {
    name: 'BACKEND',
    command: 'npx',
    args: ['tsx', 'src/index-minimal.ts'],
    cwd: join(rootDir, 'backend'),
    color: colors.green,
    port: 3001,
    healthUrl: 'http://localhost:3001/api/health'
  },
  {
    name: 'FRONTEND',
    command: 'npm',
    args: ['run', 'dev'],
    cwd: join(rootDir, 'frontend'),
    color: colors.cyan,
    port: 5173,
    healthUrl: 'http://localhost:5173'
  }
];

let processes = [];
let shutdownInProgress = false;

function log(service, message, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const color = service ? service.color : colors.reset;
  const prefix = service ? `[${service.name}]` : '[SYSTEM]';
  const logColor = isError ? colors.red : color;
  
  console.log(`${colors.bright}${timestamp}${colors.reset} ${logColor}${prefix}${colors.reset} ${message}`);
}

function checkPrerequisites() {
  log(null, 'Checking prerequisites...');
  
  // Check if .env.n8n exists
  const n8nEnvPath = join(rootDir, '.env.n8n');
  if (!fs.existsSync(n8nEnvPath)) {
    log(null, 'Missing .env.n8n file. Creating default configuration...', true);
    return false;
  }
  
  // Check if .n8n directory exists
  const n8nDir = join(rootDir, '.n8n');
  if (!fs.existsSync(n8nDir)) {
    log(null, 'Creating .n8n directory...');
    fs.mkdirSync(n8nDir, { recursive: true });
  }
  
  return true;
}

function startService(service) {
  return new Promise((resolve) => {
    log(service, `Starting ${service.name}...`);
    
    const process = spawn(service.command, service.args, {
      cwd: service.cwd,
      stdio: 'pipe',
      shell: true
    });
    
    process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log(service, output);
      }
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('ExperimentalWarning')) {
        log(service, output, true);
      }
    });
    
    process.on('close', (code) => {
      if (!shutdownInProgress) {
        log(service, `Process exited with code ${code}`, code !== 0);
      }
    });
    
    process.on('error', (error) => {
      log(service, `Failed to start: ${error.message}`, true);
    });
    
    processes.push({ service, process });
    
    // Give the service time to start
    setTimeout(() => {
      log(service, `Started on port ${service.port}`);
      resolve();
    }, 2000);
  });
}

async function startAllServices() {
  log(null, '🏗️  Starting NTG Chatbot Development Environment');
  log(null, '============================================================');
  
  if (!checkPrerequisites()) {
    process.exit(1);
  }
  
  // Start services sequentially with delays
  for (const service of services) {
    await startService(service);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  log(null, '============================================================');
  log(null, '🎉 Development environment started!');
  log(null, '');
  log(null, '📍 Services:');
  log(null, '   • N8N Workflow Engine: http://localhost:5678');
  log(null, '   • Backend API: http://localhost:3001');
  log(null, '   • Frontend App: http://localhost:5173');
  log(null, '   • Health Check: http://localhost:3001/api/health');
  log(null, '   • N8N Health: http://localhost:5678/healthz');
  log(null, '');
  log(null, '💡 Tips:');
  log(null, '   • Press Ctrl+C to stop all services');
  log(null, '   • Run "npm run health" to check service status');
  log(null, '   • Check individual service logs above');
  log(null, '============================================================');
}

function gracefulShutdown() {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  
  log(null, '');
  log(null, '🛑 Shutting down services...');
  
  processes.forEach(({ service, process }) => {
    log(service, 'Stopping...');
    
    if (process.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', process.pid, '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill('SIGTERM');
        }
      } catch (error) {
        log(service, `Error stopping: ${error.message}`, true);
      }
    }
  });
  
  setTimeout(() => {
    log(null, '✅ All services stopped');
    process.exit(0);
  }, 2000);
}

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('exit', gracefulShutdown);

// Start the development environment
startAllServices().catch((error) => {
  log(null, `Failed to start development environment: ${error.message}`, true);
  process.exit(1);
});
