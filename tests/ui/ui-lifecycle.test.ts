#!/usr/bin/env ts-node
/**
 * OCL Nexus UI Lifecycle Integration Test (Session-based)
 * 
 * This test validates the complete dashboard workflow using SSR cookies:
 * 1. Sign in with email/password using Supabase SSR client (simulates production auth)
 * 2. Deploy workload via /api/instances/deploy
 * 3. Poll status until running
 * 4. Restart instance
 * 5. Delete instance and verify cleanup via API
 * 
 * Run with: npm run test:ui
 */

import * as fs from 'fs';
import * as path from 'path';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// === Configuration ===
interface TestConfig {
  email: string;
  password: string;
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  blueprintId: string;
  skipCleanup?: boolean;
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
      if (key === 'TEST_USER_EMAIL') config.email = value;
      if (key === 'TEST_USER_PASSWORD') config.password = value;
      if (key === 'NEXUS_BASE_URL') config.baseUrl = value.replace(/\/$/, '');
      if (key === 'SUPABASE_URL') config.supabaseUrl = value;
      if (key === 'SUPABASE_ANON_KEY') config.supabaseAnonKey = value;
      if (key === 'TEST_BLUEPRINT_ID') config.blueprintId = value;
      if (key === 'SKIP_CLEANUP' && value === 'true') config.skipCleanup = true;
    }
  });

  if (!config.email || !config.password || !config.baseUrl || !config.supabaseUrl || !config.supabaseAnonKey) {
    console.error('❌ Missing required config: TEST_USER_EMAIL, TEST_USER_PASSWORD, NEXUS_BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY');
    process.exit(1);
  }

  return {
    email: config.email,
    password: config.password,
    baseUrl: config.baseUrl,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    blueprintId: config.blueprintId || 'hello-world',
    skipCleanup: config.skipCleanup || false,
  };
}

// === Utilities ===
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Main Test ===
async function runTest() {
  const startTime = Date.now();
  
  console.log('🚀 UI Lifecycle Integration Test (Session-based)');
  console.log('──────────────────────────────────────────────────\n');

  const config = loadConfig();
  const isLocalMode = config.baseUrl.includes('localhost') || config.baseUrl.includes('127.0.0.1');

  let instanceId: string | null = null;
  let subdomain: string | null = null;
  let shortId: string | null = null;
  let userId: string | null = null;
  let nodeId: string | null = null;
  const cookieStore = new Map<string, string>();

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // Step 1: Authenticate
    // ═══════════════════════════════════════════════════════════════════════
    if (isLocalMode) {
      // Local mode: createSupabaseServerClient() returns mock with dev user
      // regardless of cookies — no Supabase auth needed.
      userId = '00000000-0000-0000-0000-000000000000';
      console.log('🔐 Step 1/5: Local mode — using dev user (no Supabase auth)');
      console.log(`   ✅ Dev user: dev@localhost`);
      console.log(`   → User ID: ${userId}\n`);
    } else {
      console.log('🔐 Step 1/5: Authenticating with Supabase SSR...');

      const supabase = createServerClient(
        config.supabaseUrl,
        config.supabaseAnonKey,
        {
          cookieOptions: { domain: '.oclhosting.com' },
          cookies: {
            getAll() {
              return Array.from(cookieStore.entries()).map(([name, value]) => ({ name, value }));
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value }) => cookieStore.set(name, value));
            },
          },
        }
      );

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: config.email,
        password: config.password,
      });

      if (authError || !authData.session) {
        throw new Error(`Authentication failed: ${authError?.message || 'No session returned'}`);
      }

      userId = authData.user.id;
      console.log(`   ✅ Authenticated as: ${config.email}`);
      console.log(`   → User ID: ${userId}`);
      console.log(`   → Cookies set: ${cookieStore.size}\n`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Step 2: Deploy Workload
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`🚢 Step 2/5: Deploying workload (${config.blueprintId})...`);
    
    // Build Cookie header from cookieStore
    const cookieHeader = Array.from(cookieStore.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    
    const deployResponse = await fetch(`${config.baseUrl}/api/instances/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({ blueprintId: config.blueprintId }),
    });

    if (!deployResponse.ok) {
      const errorText = await deployResponse.text();
      throw new Error(`Deploy failed (${deployResponse.status}): ${errorText}`);
    }

    const deployData = await deployResponse.json() as any;
    instanceId = deployData.instanceId || deployData.instance_id;
    subdomain = deployData.subdomain;
    shortId = subdomain?.replace('inst-', '') || null;

    if (!instanceId || !subdomain) {
      throw new Error(`Deploy response missing instanceId or subdomain: ${JSON.stringify(deployData)}`);
    }

    console.log(`   ✅ Deployed successfully`);
    console.log(`   → Instance ID: ${instanceId}`);
    console.log(`   → Subdomain: ${subdomain}`);
    console.log(`   → Short ID: ${shortId}\n`);

    // ═══════════════════════════════════════════════════════════════════════
    // Step 3: Poll Status Until Running
    // ═══════════════════════════════════════════════════════════════════════
    console.log('⏳ Step 3/5: Waiting for instance to reach running state...');
    const maxRetries = 12;
    const pollInterval = 5000; // 5 seconds
    let isRunning = false;
    let retries = 0;

    while (retries < maxRetries && !isRunning) {
      retries++;
      
      const cookieHeader = Array.from(cookieStore.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      
      const statusResponse = await fetch(`${config.baseUrl}/api/instances/${instanceId}/status`, {
        headers: { 'Cookie': cookieHeader },
      });

      if (!statusResponse.ok) {
        throw new Error(`Status check failed (${statusResponse.status}): ${await statusResponse.text()}`);
      }

      const statusData = await statusResponse.json() as any;
      const currentStatus = statusData.status;

      console.log(`   → Poll ${retries}/${maxRetries}: status="${currentStatus}"`);

      if (currentStatus === 'running') {
        isRunning = true;
        break;
      }

      if (currentStatus === 'error') {
        throw new Error(`Instance entered error state: ${statusData.message}`);
      }

      if (retries < maxRetries) {
        await sleep(pollInterval);
      }
    }

    if (!isRunning) {
      throw new Error(`Instance did not reach running state after ${maxRetries} polls (${formatDuration(maxRetries * pollInterval)})`);
    }

    console.log(`   ✅ Instance is running\n`);

    // ═══════════════════════════════════════════════════════════════════════
    // Step 4: Restart Instance
    // ═══════════════════════════════════════════════════════════════════════
    console.log('🔄 Step 4/5: Restarting instance...');
    const cookieHeader2 = Array.from(cookieStore.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    
    const restartResponse = await fetch(`${config.baseUrl}/api/instances/${instanceId}/restart`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader2 },
    });

    if (!restartResponse.ok) {
      throw new Error(`Restart failed (${restartResponse.status}): ${await restartResponse.text()}`);
    }

    const restartData = await restartResponse.json() as any;
    console.log(`   ✅ Restart triggered successfully`);
    console.log(`   → Response: ${JSON.stringify(restartData)}\n`);

    // ═══════════════════════════════════════════════════════════════════════
    // Step 5: Delete Instance and Verify Cleanup
    // ═══════════════════════════════════════════════════════════════════════
    if (config.skipCleanup) {
      console.log('⏭️  Step 5/5: Cleanup skipped (SKIP_CLEANUP=true)\n');
    } else {
      console.log('🗑️  Step 5/5: Deleting instance and verifying cleanup...');
      const cookieHeader3 = Array.from(cookieStore.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      
      const deleteResponse = await fetch(`${config.baseUrl}/api/instances/${instanceId}`, {
        method: 'DELETE',
        headers: { 'Cookie': cookieHeader3 },
      });

      if (!deleteResponse.ok) {
        throw new Error(`Delete failed (${deleteResponse.status}): ${await deleteResponse.text()}`);
      }

      const deleteData = await deleteResponse.json() as any;
      console.log(`   ✅ Instance deleted successfully`);
      console.log(`   → Response: ${JSON.stringify(deleteData)}`);

      // Verify cleanup by attempting to fetch status (should return 404)
      console.log(`   → Verifying cleanup via API...`);
      const cookieHeader4 = Array.from(cookieStore.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      
      const verifyResponse = await fetch(`${config.baseUrl}/api/instances/${instanceId}/status`, {
        headers: { 'Cookie': cookieHeader4 },
      });

      if (verifyResponse.status === 404) {
        console.log(`   ✅ Instance fully removed (404 Not Found)`);
      } else if (!verifyResponse.ok) {
        // Any other error is acceptable as long as instance is gone
        console.log(`   ✅ Instance no longer accessible (${verifyResponse.status})`);
      } else {
        // If we get 200, instance still exists - this is a failure
        const statusData = await verifyResponse.json() as any;
        throw new Error(`Instance still exists after deletion: ${JSON.stringify(statusData)}`);
      }

      console.log(`   ✅ Cleanup verification complete\n`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test Complete
    // ═══════════════════════════════════════════════════════════════════════
    const duration = Date.now() - startTime;
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║          ✅ ALL TESTS PASSED                  ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log(`\n⏱️  Total duration: ${formatDuration(duration)}`);
    
    if (config.skipCleanup && instanceId) {
      console.log(`\n📌 Instance preserved for inspection:`);
      console.log(`   → Instance ID: ${instanceId}`);
      console.log(`   → Subdomain: ${subdomain}`);
      const debugCookie = Array.from(cookieStore.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      console.log(`   → To delete: curl -X DELETE ${config.baseUrl}/api/instances/${instanceId} -H "Cookie: ${debugCookie}"`);
    }

    process.exit(0);

  } catch (error: any) {
    console.error('\n╔═══════════════════════════════════════════════╗');
    console.error('║          ❌ TEST FAILED                       ║');
    console.error('╚═══════════════════════════════════════════════╝\n');
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    if (!config.skipCleanup && instanceId && cookieStore.size > 0) {
      console.error('\n🧹 Attempting cleanup...');
      try {
        const cleanupCookie = Array.from(cookieStore.entries())
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
        
        const cleanupResponse = await fetch(`${config.baseUrl}/api/instances/${instanceId}`, {
          method: 'DELETE',
          headers: { 'Cookie': cleanupCookie },
        });
        if (cleanupResponse.ok) {
          console.error('   ✅ Cleanup successful');
        } else {
          console.error(`   ⚠️  Cleanup failed: ${cleanupResponse.status}`);
        }
      } catch (cleanupError: any) {
        console.error(`   ⚠️  Cleanup error: ${cleanupError.message}`);
      }
    }

    process.exit(1);
  }
}

// Run the test
runTest();
