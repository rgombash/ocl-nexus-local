#!/usr/bin/env ts-node
/**
 * OCL Nexus Node.js Express Service Integration Test
 * 
 * This test validates the Service Mode capability with Node.js runtime:
 * 1. Deploy nodejs-sandbox instance
 * 2. Upload Express app code (app.js)
 * 3. Upload Nexus Entrypoint script (nexus-start.sh)
 * 4. Restart to activate service mode
 * 5. Poll for readiness
 * 6. Verify public URL access with Bearer token (M2M bouncer auth)
 * 7. Cleanup
 * 
 * Run with: npm run test:node
 */

import * as fs from 'fs';
import * as path from 'path';

// === Configuration ===
interface TestConfig {
  apiKey: string;
  baseUrl: string;
  infraDomain: string;
  skipCleanup: boolean;  // Set SKIP_CLEANUP=true to preserve instance
}

function loadConfig(): TestConfig {
  const envPath = path.join(__dirname, '../.env.test');
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ Configuration file not found: tests/.env.test');
    console.error('💡 Copy tests/.env.test.example and fill in your values');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const config: Partial<TestConfig> = {};

  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (key === 'NEXUS_API_KEY') config.apiKey = value;
      if (key === 'NEXUS_BASE_URL') config.baseUrl = value.replace(/\/$/, '');
      if (key === 'INFRA_DOMAIN') config.infraDomain = value;
      if (key === 'SKIP_CLEANUP') config.skipCleanup = value.toLowerCase() === 'true';
    }
  });

  if (!config.apiKey || !config.baseUrl || !config.infraDomain) {
    console.error('❌ Missing required config: NEXUS_API_KEY, NEXUS_BASE_URL, INFRA_DOMAIN');
    process.exit(1);
  }

  return {
    apiKey: config.apiKey!,
    baseUrl: config.baseUrl!,
    infraDomain: config.infraDomain!,
    skipCleanup: config.skipCleanup ?? false,
  };
}

// === Logging Utilities ===
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(emoji: string, message: string, color?: keyof typeof colors) {
  const colorCode = color ? colors[color] : '';
  const reset = color ? colors.reset : '';
  console.log(`${emoji}  ${colorCode}${message}${reset}`);
}

function logStep(step: number, total: number, title: string) {
  console.log(`\n${colors.bright}${colors.cyan}[${step}/${total}] ${title}${colors.reset}`);
  console.log(colors.dim + '─'.repeat(60) + colors.reset);
}

function logSuccess(message: string) {
  log('✅', message, 'green');
}

function logError(message: string) {
  log('❌', message, 'red');
}

function logInfo(message: string) {
  log('ℹ️ ', message, 'blue');
}

function logWarning(message: string) {
  log('⚠️ ', message, 'yellow');
}

// === Helper Functions ===
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === API Client ===
interface DeployResponse {
  ok: boolean;
  subdomain: string;
  instanceId: string;
  instance_id: string;
}

interface StatusResponse {
  status: string;
  subdomain: string;
  created_at: string;
}

interface FileUploadResponse {
  ok: boolean;
  path: string;
  fullPath: string;
  message: string;
}

interface HealthCheckResponse {
  status: string;
  runtime?: string;
}

interface RestartResponse {
  ok: boolean;
  message: string;
}

async function makeRequest(
  config: TestConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  return fetch(url, options);
}

async function deployWorkload(config: TestConfig): Promise<DeployResponse> {
  logInfo('Deploying nodejs-sandbox instance...');
  
  const response = await makeRequest(config, 'POST', '/api/v1/workloads', {
    blueprint_id: 'nodejs-sandbox',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deployment failed (${response.status}): ${text}`);
  }

  const data = await response.json() as DeployResponse;
  logSuccess(`Instance deployed: ${data.subdomain}`);
  logInfo(`Instance ID: ${data.instanceId}`);
  
  return data;
}

async function uploadFile(
  config: TestConfig,
  instanceId: string,
  filePath: string,
  content: string
): Promise<void> {
  logInfo(`Uploading file: ${filePath}`);
  
  const response = await makeRequest(
    config,
    'POST',
    `/api/v1/workloads/${instanceId}/files`,
    {
      path: filePath,
      content: content,
      encoding: 'utf8',
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`File upload failed (${response.status}): ${text}`);
  }

  const data = await response.json() as FileUploadResponse;
  logSuccess(`Uploaded: ${data.fullPath}`);
}

async function restartInstance(
  config: TestConfig,
  instanceId: string
): Promise<void> {
  logInfo('Restarting instance to activate service mode...');
  
  // Use M2M restart endpoint
  const response = await makeRequest(
    config,
    'POST',
    `/api/v1/workloads/${instanceId}/restart`
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Restart failed (${response.status}): ${text}`);
  }

  const data = await response.json() as RestartResponse;
  logSuccess(data.message || 'Instance restarted');
}

async function fetchLogs(
  config: TestConfig,
  instanceId: string
): Promise<string> {
  try {
    // Try to fetch logs via UI API (M2M logs endpoint not implemented yet)
    const url = `${config.baseUrl}/api/instances/${instanceId}/logs`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json() as { logs?: string };
      return data.logs || 'No logs available';
    }
    
    return `Failed to fetch logs: ${response.status}`;
  } catch (err) {
    return `Error fetching logs: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function pollReadiness(
  config: TestConfig,
  instanceId: string,
  maxRetries: number = 24,
  intervalMs: number = 5000
): Promise<void> {
  logInfo(`Polling readiness (max ${maxRetries} retries, ${intervalMs / 1000}s interval)...`);
  
  for (let i = 1; i <= maxRetries; i++) {
    const response = await makeRequest(config, 'GET', `/api/v1/workloads/${instanceId}/status`);
    
    if (!response.ok) {
      throw new Error(`Status check failed (${response.status})`);
    }

    const data = await response.json() as StatusResponse;
    logInfo(`[${i}/${maxRetries}] Status: ${data.status}`);

    if (data.status === 'running') {
      logSuccess('Instance is running!');
      return;
    }

    if (data.status === 'error') {
      logError('Instance entered error state. Fetching logs...');
      const logs = await fetchLogs(config, instanceId);
      console.log('\n' + colors.yellow + '────── Container Logs ──────' + colors.reset);
      console.log(logs);
      console.log(colors.yellow + '─'.repeat(60) + colors.reset + '\n');
      throw new Error('Instance entered error state (see logs above)');
    }

    await sleep(intervalMs);
  }

  throw new Error(`Readiness timeout after ${maxRetries} retries`);
}

async function verifyService(
  config: TestConfig,
  subdomain: string,
  maxRetries: number = 12,
  intervalMs: number = 5000
): Promise<void> {
  logInfo('Verifying Express service via public URL...');
  
  const isLocal = config.infraDomain === "localhost" || config.infraDomain === "localtest.me";
  const url = `${isLocal ? "http" : "https"}://${subdomain}.${config.infraDomain}/health`;
  logInfo(`Testing: ${url}`);
  logInfo(`Will retry up to ${maxRetries} times with ${intervalMs / 1000}s interval...`);
  
  for (let i = 1; i <= maxRetries; i++) {
    // Make request with Bearer token for M2M bouncer auth
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    if (response.ok) {
      const data = await response.json() as HealthCheckResponse;
      
      if (data.status === 'online' && data.runtime === 'node') {
        logSuccess(`Service responding: ${JSON.stringify(data)}`);
        return;
      }
      
      logWarning(`[${i}/${maxRetries}] Unexpected response: ${JSON.stringify(data)}`);
    } else {
      logInfo(`[${i}/${maxRetries}] Service not ready yet (${response.status})`);
    }

    if (i < maxRetries) {
      await sleep(intervalMs);
    }
  }

  // Final attempt to get error details
  const finalResponse = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
    },
  });
  
  const text = await finalResponse.text();
  throw new Error(`Service verification failed after ${maxRetries} retries (${finalResponse.status}): ${text.substring(0, 500)}...`);
}

async function deleteWorkload(config: TestConfig, instanceId: string): Promise<void> {
  logInfo('Deleting instance...');
  
  const response = await makeRequest(config, 'DELETE', `/api/v1/workloads/${instanceId}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deletion failed (${response.status}): ${text}`);
  }

  logSuccess('Instance deleted');
}

// === Main Test ===
async function main() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   OCL Nexus Node.js Express Service Integration Test      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);

  const config = loadConfig();
  let instanceId: string | null = null;
  let subdomain: string | null = null;

  try {
    // ── Step 1: Deploy ────────────────────────────────────────────────
    logStep(1, 8, '🚀 Deploy nodejs-sandbox');
    const deployment = await deployWorkload(config);
    instanceId = deployment.instanceId;
    subdomain = deployment.subdomain;

    // ── Step 2: Poll Initial Readiness ───────────────────────────────
    logStep(2, 8, '⏳ Poll Initial Readiness (Wait for Pod to Start)');
    await pollReadiness(config, instanceId);

    // ── Step 3: Upload Express App ───────────────────────────────────
    logStep(3, 8, '📦 Upload Express Application');
    
    const expressApp = `const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'online', runtime: 'node' });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'OCL Nexus Node.js Service',
    mode: 'service',
    runtime: 'node',
    version: process.version
  });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Express server running on port 3000');
});
`;

    await uploadFile(config, instanceId, 'app.js', expressApp);

    // ── Step 4: Upload Nexus Entrypoint Script ──────────────────────
    logStep(4, 8, '📝 Upload Nexus Entrypoint Script');
    
    const startScript = `#!/bin/bash
set -e

echo "🔧 Installing Express..."
npm install express

echo "🚀 Starting Express service on port 3000..."
exec node app.js
`;

    await uploadFile(config, instanceId, 'nexus-start.sh', startScript);

    // ── Step 5: Restart to Activate Service Mode ────────────────────
    logStep(5, 8, '🔄 Restart Instance (Activate Service Mode)');
    await restartInstance(config, instanceId);
    
    // Wait a bit for restart to begin
    logInfo('Waiting 3 seconds for restart to begin...');
    await sleep(3000);

    // ── Step 6: Poll Readiness After Restart ─────────────────────────
    logStep(6, 8, '⏳ Poll Readiness After Restart');
    await pollReadiness(config, instanceId);

    // ── Step 7: Verify Service via Public URL (M2M Auth) ────────────
    logStep(7, 8, '🌐 Verify Public URL Access (Bearer Token)');
    await verifyService(config, subdomain);

    // ── Step 8: Cleanup ──────────────────────────────────────────────
    if (config.skipCleanup) {
      logStep(8, 8, '⏭️  Cleanup Skipped');
      logWarning('SKIP_CLEANUP=true — Instance preserved for inspection');
      logInfo(`Instance ID: ${instanceId}`);
      logInfo(`Subdomain: ${subdomain}.${config.infraDomain}`);
      logInfo(`Manual cleanup: npm run test:node (without SKIP_CLEANUP flag)`);
    } else {
      logStep(8, 8, '🧹 Cleanup');
      await deleteWorkload(config, instanceId);
    }

    // ── Summary ──────────────────────────────────────────────────────
    console.log(`\n${colors.bright}${colors.green}`);
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   ✅ All Tests Passed!                                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(colors.reset);
    console.log();
    logSuccess('Node.js Service Mode validated successfully');
    logSuccess('Nexus Entrypoint convention working correctly');
    logSuccess('Bearer token authentication functional');
    logSuccess('OCL Nexus is language-agnostic and ready for production');
    console.log();

  } catch (error) {
    console.log(`\n${colors.bright}${colors.red}`);
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   ❌ Test Failed                                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(colors.reset);
    console.log();
    logError(error instanceof Error ? error.message : String(error));
    console.log();

    // Attempt cleanup even on failure (unless explicitly skipped)
    if (instanceId && !config.skipCleanup) {
      try {
        logInfo('Attempting cleanup after failure...');
        await deleteWorkload(config, instanceId);
      } catch (cleanupError) {
        logWarning('Cleanup failed (non-critical)');
      }
    }

    process.exit(1);
  }
}

// Execute test
main();
