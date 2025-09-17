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
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function runCommand(command, args, cwd, description) {
  return new Promise((resolve, reject) => {
    log(`\n🔧 ${description}...`, colors.cyan);
    
    const process = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      shell: true
    });

    let output = '';
    
    process.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(text.trim());
    });

    process.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(text.trim());
    });

    process.on('close', (code) => {
      if (code === 0) {
        log(`✅ ${description} completed`, colors.green);
        resolve(output);
      } else {
        log(`❌ ${description} failed with code ${code}`, colors.red);
        reject(new Error(`${description} failed`));
      }
    });
  });
}

async function setupEnvironment() {
  log('📋 Setting up local development environment...', colors.blue);
  
  // Check if .env.local exists, if not copy from .env.example
  const envLocalPath = join(rootDir, '.env.local');
  const envExamplePath = join(rootDir, '.env.example');
  
  if (!fs.existsSync(envLocalPath)) {
    if (fs.existsSync(envExamplePath)) {
      log('📄 Creating .env.local from .env.example...', colors.yellow);
      fs.copyFileSync(envExamplePath, envLocalPath);
      log('✅ Created .env.local - please review and update as needed', colors.green);
    } else {
      log('❌ No .env.example found to copy from', colors.red);
      throw new Error('Environment setup failed');
    }
  } else {
    log('✅ .env.local already exists', colors.green);
  }
}

async function installDependencies() {
  log('\n📦 Installing dependencies...', colors.blue);
  
  // Install root dependencies
  await runCommand('npm', ['install'], rootDir, 'Installing root dependencies');
  
  // Install backend dependencies
  const backendDir = join(rootDir, 'backend');
  if (fs.existsSync(join(backendDir, 'package.json'))) {
    await runCommand('npm', ['install'], backendDir, 'Installing backend dependencies');
  }
  
  // Install frontend dependencies
  const frontendDir = join(rootDir, 'frontend');
  if (fs.existsSync(join(frontendDir, 'package.json'))) {
    await runCommand('npm', ['install'], frontendDir, 'Installing frontend dependencies');
  }
}

async function setupDatabase() {
  log('\n🗄️ Setting up SQLite database...', colors.blue);
  
  const backendDir = join(rootDir, 'backend');
  
  // Generate Prisma client
  await runCommand('npx', ['prisma', 'generate', '--schema=./prisma/schema.dev.prisma'], 
    backendDir, 'Generating Prisma client for SQLite');
  
  // Run migrations
  await runCommand('npx', ['prisma', 'db', 'push', '--schema=./prisma/schema.dev.prisma'], 
    backendDir, 'Setting up SQLite database schema');
  
  // Seed database (if seed file exists)
  const seedPath = join(backendDir, 'prisma', 'seed.ts');
  if (fs.existsSync(seedPath)) {
    try {
      await runCommand('npx', ['prisma', 'db', 'seed'], backendDir, 'Seeding database');
    } catch (error) {
      log('⚠️ Database seeding failed - continuing anyway', colors.yellow);
    }
  }
}

async function validateSetup() {
  log('\n🔍 Validating setup...', colors.blue);
  
  // Check if key files exist
  const requiredFiles = [
    join(rootDir, '.env.local'),
    join(rootDir, 'backend', 'node_modules'),
    join(rootDir, 'frontend', 'node_modules'),
    join(rootDir, 'backend', 'prisma', 'schema.dev.prisma')
  ];
  
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      log(`✅ ${file.replace(rootDir, '.')} exists`, colors.green);
    } else {
      log(`❌ ${file.replace(rootDir, '.')} missing`, colors.red);
      throw new Error('Setup validation failed');
    }
  }
}

async function main() {
  log('🏗️  NTG Chatbot Local Development Setup', colors.bright);
  log('=' .repeat(50), colors.bright);
  
  try {
    await setupEnvironment();
    await installDependencies();
    await setupDatabase();
    await validateSetup();
    
    log('\n' + '='.repeat(50), colors.bright);
    log('🎉 Local development setup completed!', colors.green);
    log('', colors.reset);
    log('📍 Next steps:', colors.bright);
    log('   1. Review and update .env.local if needed', colors.yellow);
    log('   2. Run: npm run dev:start', colors.yellow);
    log('   3. Open: http://localhost:5173 (frontend)', colors.yellow);
    log('   4. API available at: http://localhost:3001', colors.yellow);
    log('=' .repeat(50), colors.bright);
    
  } catch (error) {
    log(`\n❌ Setup failed: ${error.message}`, colors.red);
    log('Please check the errors above and try again.', colors.yellow);
    process.exit(1);
  }
}

main().catch(console.error);
