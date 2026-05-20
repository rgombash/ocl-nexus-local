# OCL Nexus Integration Tests

This directory contains automated integration tests for the Nexus Orchestration API.

## Setup

1. **Copy the environment template:**
   ```bash
   cp tests/.env.test.example tests/.env.test
   ```

2. **Configure your test credentials:**
   Edit `tests/.env.test` and set:
   - `NEXUS_API_KEY` - Your API key from Dashboard → Settings → API Keys
   - `NEXUS_BASE_URL` - Platform URL (default: https://oclhosting.com)
   - `INFRA_DOMAIN` - Infrastructure domain for public URLs (default: oclhosting.com)
   - `TEST_BLUEPRINT_ID` - Blueprint to test (default: python-sandbox)

3. **Install dependencies:**
   ```bash
   npm install
   ```

## Running Tests

### API Lifecycle Test
Tests the complete workload lifecycle: Deploy → Upload → Execute → Delete

```bash
npm run test:api
```

**What it tests:**
- ✅ Authentication & Authorization (401 on invalid keys)
- ✅ Blueprint availability
- ✅ Workload deployment
- ✅ Readiness polling (up to 2 minutes)
- ✅ File upload to Code PVC
- ✅ Remote command execution
- ✅ Output validation
- ✅ Workload termination

**Expected output:**
```
╔════════════════════════════════════════════════════════════╗
║   🚀 OCL Nexus API Lifecycle Integration Test             ║
╚════════════════════════════════════════════════════════════╝

ℹ️   Base URL: https://oclhosting.com
ℹ️   Blueprint: python-sandbox
ℹ️   API Key: nx_747646a...

[1/7] Authentication Challenge
────────────────────────────────────────────────────────
✅  Invalid auth correctly rejected (401)
✅  Valid auth accepted

[2/7] Blueprint Discovery
────────────────────────────────────────────────────────
✅  Blueprint python-sandbox is available

[3/7] Workload Deployment
────────────────────────────────────────────────────────
✅  Workload deployed: inst-a1b2c3d4

[4/7] Readiness Polling
────────────────────────────────────────────────────────
⏳  Polling readiness... (1/12)
✅  Workload is running

[5/7] Code Shipment (File Upload)
────────────────────────────────────────────────────────
✅  File uploaded successfully

[6/7] Remote Execution
────────────────────────────────────────────────────────
─── stdout ───
Environment: none
Nexus PVC Write: Success
─── stderr ───
(empty)
─────────────

✅  Command executed successfully with expected output

[7/7] Workload Termination
────────────────────────────────────────────────────────
✅  Workload deleted successfully

╔════════════════════════════════════════════════════════════╗
║   📊 Test Summary                                          ║
╚════════════════════════════════════════════════════════════╝
✅  Passed: 8
❌  Failed: 0
📈  Success Rate: 100.0%

🎉 All tests passed! OCL Nexus is a functioning Agentic Cloud.
```

### Python Flask Service Test
Tests Service Mode capability with M2M authentication through the bouncer:

```bash
npm run test:python
```

**What it tests:**
- ✅ Python sandbox deployment
- ✅ Flask application code upload
- ✅ Nexus Entrypoint script upload (nexus-start.sh)
- ✅ Service mode activation via restart
- ✅ Readiness polling after restart
- ✅ Public URL access with Bearer token (M2M bouncer auth)
- ✅ Flask service response validation
- ✅ Cleanup

**Expected output:**
```
╔════════════════════════════════════════════════════════════╗
║   OCL Nexus Python Flask Service Integration Test         ║
╚════════════════════════════════════════════════════════════╝

[1/7] 🚀 Deploy python-sandbox
────────────────────────────────────────────────────────
✅  Instance deployed: inst-a1b2c3d4

[2/7] 📦 Upload Flask Application
────────────────────────────────────────────────────────
✅  Uploaded: /app/app.py

[3/7] 📝 Upload Nexus Entrypoint Script
────────────────────────────────────────────────────────
✅  Uploaded: /app/nexus-start.sh

[4/7] 🔄 Restart Instance (Activate Service Mode)
────────────────────────────────────────────────────────
✅  Instance restarted

[5/7] ⏳ Poll Readiness
────────────────────────────────────────────────────────
✅  Instance is running!

[6/7] 🌐 Verify Public URL Access (Bearer Token)
────────────────────────────────────────────────────────
ℹ️   Testing: https://inst-a1b2c3d4.oclhosting.com/health
✅  Service responding: {"status":"online"}

[7/7] 🧹 Cleanup
────────────────────────────────────────────────────────
✅  Instance deleted

╔════════════════════════════════════════════════════════════╗
║  🎉 All tests passed! Flask Service Mode verified.        ║
╚════════════════════════════════════════════════════════════╝
```

**What this validates:**
- **Service Mode:** Nexus Entrypoint finds and executes nexus-start.sh
- **M2M Bouncer Auth:** Bearer tokens work through ForwardAuth
- **Flask on Port 8000:** Long-running web service stays alive
- **Public URL Access:** Agents can reach services programmatically

**Debug mode:** To preserve instances for manual inspection, add to `tests/.env.test`:
```bash
SKIP_CLEANUP=true
```

This will skip cleanup and display instance details:
```
⚠️  Cleanup Skipped (SKIP_CLEANUP=true)

📌 Instance preserved for manual inspection:
   Instance ID: f8698850-7ae9-4f3d-ba6b-3a76f975488a
   Subdomain:   https://inst-25111ba4.oclhosting.com

💡 Delete manually when done: DELETE /api/v1/workloads/f8698850-7ae9-4f3d-ba6b-3a76f975488a
```

## Test Coverage

### API Endpoints Tested

**Lifecycle Test:**
- `GET /api/v1/test` - Auth validation
- `POST /api/v1/workloads` - Workload creation (M2M)
- `GET /api/v1/workloads/[id]/status` - Status polling
- `POST /api/v1/workloads/[id]/files` - File shipment
- `POST /api/v1/workloads/[id]/execute` - Remote execution
- `DELETE /api/v1/workloads/[id]` - Workload deletion (M2M)

**Flask Service Test:**
- `POST /api/v1/workloads` - Deploy python-sandbox
- `POST /api/v1/workloads/[id]/files` - Upload Flask app + start script
- `PATCH /api/instances/[id]/restart` - Activate service mode
- `GET /api/v1/workloads/[id]/status` - Poll readiness
- `GET https://[subdomain].[domain]/health` - Public URL with Bearer token
- `DELETE /api/v1/workloads/[id]` - Cleanup

### Blueprints Tested
- **python-sandbox** - Python 3.12 with Homebrew
- **nodejs-sandbox** - Node.js 20 with pnpm and Homebrew

## Troubleshooting

### "Configuration file not found"
Copy `.env.test.example` to `.env.test` and fill in your credentials.

### "Authentication failed with valid key"
- Check your API key is correct (format: `nx_...`)
- Ensure you have sufficient balance or VIP status
- Verify the key hasn't been revoked

### "Workload failed to become ready"
- Check your account balance
- Verify the blueprint exists and is stable
- Check admin dashboard for pod errors
- May need to increase readiness timeout (currently 2 minutes)

### "File upload failed" or "Command execution failed"
- Ensure the instance is running (`status: running`)
- Check that the blueprint supports Code PVC (`codePersistence: true`)
- Verify the pod has initialized properly (check logs)

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Run API Integration Tests
  env:
    NEXUS_API_KEY: ${{ secrets.NEXUS_API_KEY }}
    NEXUS_BASE_URL: https://oclhosting.com
    TEST_BLUEPRINT_ID: python-sandbox
  run: |
    echo "NEXUS_API_KEY=$NEXUS_API_KEY" > tests/.env.test
    echo "NEXUS_BASE_URL=$NEXUS_BASE_URL" >> tests/.env.test
    echo "TEST_BLUEPRINT_ID=$TEST_BLUEPRINT_ID" >> tests/.env.test
    npm run test:api
```

## Security Note

⚠️ **Never commit `tests/.env.test` to version control!**

The file contains your API key and is automatically ignored by `.gitignore`.
Only commit `.env.test.example` as a template.
