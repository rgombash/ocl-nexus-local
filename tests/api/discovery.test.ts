/**
 * OCL Nexus — Blueprint Discovery & Internal URLs Test
 * Tests Phase 5.5 Part 2 implementation
 */

import * as fs from "fs";
import * as path from "path";

// === Configuration ===
interface TestConfig {
  apiKey: string;
  baseUrl: string;
  infraDomain: string;
}

function loadConfig(): TestConfig {
  const envPath = path.join(__dirname, "../.env.test");

  if (!fs.existsSync(envPath)) {
    console.error("❌ Configuration file not found: tests/.env.test");
    console.error("💡 Copy tests/.env.test.example and fill in your values");
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  const config: Partial<TestConfig> = {};

  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (key === "NEXUS_API_KEY") config.apiKey = value;
      if (key === "NEXUS_BASE_URL") config.baseUrl = value.replace(/\/$/, "");
      if (key === "INFRA_DOMAIN") config.infraDomain = value;
    }
  });

  if (!config.apiKey || !config.baseUrl || !config.infraDomain) {
    console.error("❌ Missing required configuration");
    console.error("   Required: NEXUS_API_KEY, NEXUS_BASE_URL, INFRA_DOMAIN");
    process.exit(1);
  }

  return config as TestConfig;
}

const config = loadConfig();
const BASE_URL = config.baseUrl;
const API_KEY = config.apiKey;
const INFRA_DOMAIN = config.infraDomain;

interface TestResult {
  passed: number;
  failed: number;
  tests: Array<{ name: string; status: "✅" | "❌"; message?: string }>;
}

const results: TestResult = {
  passed: 0,
  failed: 0,
  tests: [],
};

function logSuccess(name: string) {
  results.tests.push({ name, status: "✅" });
  results.passed++;
  console.log(`✅  ${name}`);
}

function logFailure(name: string, message: string) {
  results.tests.push({ name, status: "❌", message });
  results.failed++;
  console.error(`❌  ${name}`);
  console.error(`   ${message}`);
}

function logInfo(message: string) {
  console.log(`ℹ️   ${message}`);
}

function logSection(title: string, step: string) {
  console.log(`\n${step} ${title}`);
  console.log("─".repeat(60));
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   🔍 OCL Nexus Discovery & Internal URLs Test             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  logInfo(`Base URL: ${BASE_URL}`);
  logInfo(`API Key: ${API_KEY.substring(0, 11)}...`);
  logInfo(`Infra Domain: ${INFRA_DOMAIN}\n`);

  let instanceId: string | null = null;
  let subdomain: string | null = null;
  let internalUrl: string | null = null;

  try {
    // ────────────────────────────────────────────────────────────────────
    // Step 1: Blueprint Discovery
    // ────────────────────────────────────────────────────────────────────
    logSection("Blueprint Discovery (GET /api/v1/blueprints)", "[1/5]");

    logInfo("Fetching available blueprints...");
    const blueprintsRes = await fetch(`${BASE_URL}/api/v1/blueprints`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (!blueprintsRes.ok) {
      throw new Error(`Blueprint discovery failed: ${blueprintsRes.status}`);
    }

    const blueprintsData = (await blueprintsRes.json()) as any;

    if (!blueprintsData.ok || !Array.isArray(blueprintsData.blueprints)) {
      throw new Error("Invalid blueprint response structure");
    }

    logInfo(`Found ${blueprintsData.count} blueprints`);
    logSuccess("Blueprint discovery endpoint working");

    // Verify python-sandbox exists
    const pythonSandbox = blueprintsData.blueprints.find(
      (b: any) => b.id === "python-sandbox"
    );

    if (!pythonSandbox) {
      throw new Error("python-sandbox blueprint not found");
    }

    logInfo(`python-sandbox port: ${pythonSandbox.port}`);
    logInfo(`python-sandbox display: ${pythonSandbox.displayName}`);
    logSuccess("python-sandbox blueprint available with port metadata");

    // Verify runtimeInfo is present for python-sandbox
    if (!pythonSandbox.runtimeInfo) {
      throw new Error("python-sandbox blueprint missing runtimeInfo");
    }
    if (!pythonSandbox.runtimeInfo.runtime || !Array.isArray(pythonSandbox.runtimeInfo.packageManagers)) {
      throw new Error("python-sandbox runtimeInfo missing runtime or packageManagers");
    }
    if (pythonSandbox.runtimeInfo.serviceMode !== true) {
      throw new Error("python-sandbox runtimeInfo.serviceMode should be true");
    }
    logInfo(`python-sandbox runtime: ${pythonSandbox.runtimeInfo.runtime}`);
    logInfo(`python-sandbox packageManagers: ${pythonSandbox.runtimeInfo.packageManagers.join(", ")}`);
    logSuccess("python-sandbox runtimeInfo present with serviceMode=true");

    // ────────────────────────────────────────────────────────────────────
    // Step 2: Deploy Workload (to test internal URL in response)
    // ────────────────────────────────────────────────────────────────────
    logSection("Deploy Workload (test internalUrl in response)", "[2/5]");

    logInfo("Deploying python-sandbox...");
    const deployRes = await fetch(`${BASE_URL}/api/v1/workloads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ blueprint_id: "python-sandbox" }),
    });

    if (!deployRes.ok) {
      throw new Error(`Deployment failed: ${deployRes.status}`);
    }

    const deployData = (await deployRes.json()) as any;

    if (!deployData.ok || !deployData.instanceId || !deployData.internalUrl) {
      throw new Error("Deployment response missing required fields");
    }
    if (!deployData.publicUrl) {
      throw new Error("Deployment response missing publicUrl");
    }

    instanceId = deployData.instanceId;
    subdomain = deployData.subdomain;
    internalUrl = deployData.internalUrl;

    logInfo(`Instance ID: ${instanceId}`);
    logInfo(`Subdomain: ${subdomain}`);
    logInfo(`Internal URL: ${internalUrl}`);
    logInfo(`Public URL: ${deployData.publicUrl}`);
    logSuccess("Deploy response includes internalUrl and publicUrl");

    // Verify internal URL format — always port 80 (K8s Service port)
    const shortId = subdomain!.replace("inst-", "");
    const expectedUrl = `http://svc-${shortId}:80`;

    if (internalUrl !== expectedUrl) {
      throw new Error(
        `Internal URL mismatch: expected ${expectedUrl}, got ${internalUrl}`
      );
    }

    logSuccess("Internal URL format correct (http://svc-{shortId}:80)");

    // ────────────────────────────────────────────────────────────────────
    // Step 3: Wait for Readiness
    // ────────────────────────────────────────────────────────────────────
    logSection("Readiness Polling", "[3/5]");

    logInfo("Waiting for workload to become ready...");
    let ready = false;
    let attempts = 0;
    const maxAttempts = 12;

    while (!ready && attempts < maxAttempts) {
      attempts++;
      console.log(`⏳  Polling readiness... (${attempts}/${maxAttempts})`);

      await new Promise((resolve) => setTimeout(resolve, 10000));

      const statusRes = await fetch(
        `${BASE_URL}/api/v1/workloads/${instanceId}/status`,
        {
          headers: { Authorization: `Bearer ${API_KEY}` },
        }
      );

      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as any;
        logInfo(`Current status: ${statusData.status} (isReady: ${statusData.isReady})`);

        if (statusData.status === "running" && statusData.isReady === true) {
          ready = true;
        }
      }
    }

    if (!ready) {
      throw new Error("Workload did not become ready in time");
    }

    logSuccess("Workload is ready");

    // ────────────────────────────────────────────────────────────────────
    // Step 4: Status Endpoint (verify internalUrl included)
    // ────────────────────────────────────────────────────────────────────
    logSection("Status Endpoint (verify internalUrl)", "[4/5]");

    logInfo("Fetching workload status...");
    const statusRes = await fetch(
      `${BASE_URL}/api/v1/workloads/${instanceId}/status`,
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
      }
    );

    if (!statusRes.ok) {
      throw new Error(`Status fetch failed: ${statusRes.status}`);
    }

    const statusData = (await statusRes.json()) as any;

    if (!statusData.internalUrl) {
      throw new Error("Status response missing internalUrl");
    }

    if (!statusData.subdomain) {
      throw new Error("Status response missing subdomain");
    }

    if (!statusData.created_at) {
      throw new Error("Status response missing created_at");
    }

    if (!statusData.publicUrl) {
      throw new Error("Status response missing publicUrl");
    }

    if (statusData.isReady !== true) {
      throw new Error(`Status response isReady should be true, got: ${statusData.isReady}`);
    }

    logInfo(`Status: ${statusData.status}`);
    logInfo(`isReady: ${statusData.isReady}`);
    logInfo(`Subdomain: ${statusData.subdomain}`);
    logInfo(`Internal URL: ${statusData.internalUrl}`);
    logInfo(`Public URL: ${statusData.publicUrl}`);
    logInfo(`Created: ${statusData.created_at}`);
    logSuccess("Status response includes all network metadata (internalUrl, publicUrl, isReady)");

    if (statusData.internalUrl !== internalUrl) {
      throw new Error("Internal URL mismatch between deploy and status");
    }

    const expectedPublicUrl = `https://${subdomain}.${INFRA_DOMAIN}`;
    if (statusData.publicUrl !== expectedPublicUrl) {
      throw new Error(`publicUrl mismatch: expected ${expectedPublicUrl}, got ${statusData.publicUrl}`);
    }

    logSuccess("Internal URL and publicUrl consistent across endpoints");

    // ────────────────────────────────────────────────────────────────────
    // Step 5: Workload List (verify internalUrl included)
    // ────────────────────────────────────────────────────────────────────
    logSection("Workload List (GET /api/v1/workloads)", "[5/5]");

    logInfo("Fetching workload list...");
    const listRes = await fetch(`${BASE_URL}/api/v1/workloads`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (!listRes.ok) {
      throw new Error(`Workload list failed: ${listRes.status}`);
    }

    const listData = (await listRes.json()) as any;

    if (!listData.ok || !Array.isArray(listData.workloads)) {
      throw new Error("Invalid workload list response structure");
    }

    logInfo(`Found ${listData.count} workload(s)`);
    logSuccess("Workload list endpoint working");

    // Find our deployed instance
    const ourInstance = listData.workloads.find((w: any) => w.id === instanceId);

    if (!ourInstance) {
      throw new Error("Deployed instance not found in workload list");
    }

    if (!ourInstance.internalUrl) {
      throw new Error("Workload list entry missing internalUrl");
    }

    logInfo(`Instance found in list with internalUrl: ${ourInstance.internalUrl}`);
    logSuccess("Workload list includes internal URLs");

    if (ourInstance.internalUrl !== internalUrl) {
      throw new Error("Internal URL mismatch in workload list");
    }

    logSuccess("Internal URL consistent across all endpoints");

  } catch (err: any) {
    logFailure("Test execution failed", err.message);
  } finally {
    // ────────────────────────────────────────────────────────────────────
    // Cleanup
    // ────────────────────────────────────────────────────────────────────
    if (instanceId && process.env.SKIP_CLEANUP !== "true") {
      console.log("\n🧹 Cleanup");
      console.log("─".repeat(60));
      logInfo(`Deleting workload ${instanceId}...`);

      try {
        const deleteRes = await fetch(
          `${BASE_URL}/api/v1/workloads/${instanceId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${API_KEY}` },
          }
        );

        if (deleteRes.ok) {
          logSuccess("Workload deleted successfully");
        } else {
          logInfo(`Cleanup failed: ${deleteRes.status} (non-critical)`);
        }
      } catch (err: any) {
        logInfo(`Cleanup error: ${err.message} (non-critical)`);
      }
    } else if (process.env.SKIP_CLEANUP === "true") {
      logInfo("Cleanup skipped (SKIP_CLEANUP=true)");
      if (instanceId) {
        logInfo(`Instance ID for manual inspection: ${instanceId}`);
        logInfo(`Subdomain: ${subdomain}`);
        logInfo(`Internal URL: ${internalUrl}`);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Summary
    // ────────────────────────────────────────────────────────────────────
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   📊 Test Summary                                          ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log(`✅  Passed: ${results.passed}`);
    console.log(`❌  Failed: ${results.failed}`);
    console.log(`📈  Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%\n`);

    if (results.failed === 0) {
      console.log("🎉 All tests passed! Blueprint Discovery & Internal URLs working perfectly.\n");
      process.exit(0);
    } else {
      console.log("❌ Some tests failed. See details above.\n");
      process.exit(1);
    }
  }
}

main();
