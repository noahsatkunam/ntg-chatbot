#!/usr/bin/env node

import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const services = [
  {
    name: 'Backend API',
    url: 'http://localhost:3001/api/health',
    port: 3001
  },
  {
    name: 'Frontend',
    url: 'http://localhost:5173',
    port: 5173
  },
  {
    name: 'N8N',
    url: 'http://localhost:5678/healthz',
    port: 5678
  }
];

async function checkPort(port) {
  try {
    const { stdout } = await execAsync(`netstat -an | findstr :${port}`);
    return stdout.includes(`:${port}`);
  } catch (error) {
    return false;
  }
}

async function checkService(service) {
  try {
    // First check if port is listening
    const portOpen = await checkPort(service.port);
    if (!portOpen) {
      return {
        name: service.name,
        status: 'down',
        message: `Port ${service.port} not listening`
      };
    }

    // Then check HTTP response
    const response = await fetch(service.url, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Health-Check-Script' }
    });
    
    if (response.ok) {
      return {
        name: service.name,
        status: 'healthy',
        message: `HTTP ${response.status}`
      };
    } else {
      return {
        name: service.name,
        status: 'unhealthy',
        message: `HTTP ${response.status}`
      };
    }
  } catch (error) {
    return {
      name: service.name,
      status: 'error',
      message: error.message
    };
  }
}

async function main() {
  console.log('🏥 Health Check - NTG Chatbot Platform\n');
  
  const results = await Promise.all(services.map(checkService));
  
  let allHealthy = true;
  
  results.forEach(result => {
    const icon = result.status === 'healthy' ? '✅' : 
                 result.status === 'down' ? '🔴' : 
                 result.status === 'unhealthy' ? '⚠️' : '❌';
    
    console.log(`${icon} ${result.name}: ${result.status.toUpperCase()} - ${result.message}`);
    
    if (result.status !== 'healthy') {
      allHealthy = false;
    }
  });
  
  console.log('\n' + '='.repeat(50));
  
  if (allHealthy) {
    console.log('🎉 All services are healthy!');
    process.exit(0);
  } else {
    console.log('⚠️  Some services need attention');
    process.exit(1);
  }
}

main().catch(console.error);
