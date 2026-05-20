#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
# OCL Nexus Local — Initialization Script
# ═══════════════════════════════════════════════════════════════════════════
# This script is IDEMPOTENT — safe to run multiple times.
#
# What it does:
#   1. Applies schema-local.sql (if not already applied)
#   2. Creates a default dev user (if not exists)
#   3. Generates a default API key (if not exists)
#   4. Prints the API key for Claude Desktop configuration
# ═══════════════════════════════════════════════════════════════════════════

set -e

echo "════════════════════════════════════════════════════════════════════════"
echo "  OCL Nexus Local — Initialization"
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ─── Environment Validation ──────────────────────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL is not set"
  exit 1
fi

if [ -z "$ENCRYPTION_KEY" ] || [ "$ENCRYPTION_KEY" = "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32" ] || [ "$ENCRYPTION_KEY" = "nexus-local-dev-key-change-me!!!" ]; then
  echo "⚠️  WARNING: ENCRYPTION_KEY is using the default dev value"
  echo "   For production use, set a unique 32-character key:"
  echo "   LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32"
  echo ""
fi

# Extract connection details from DATABASE_URL
export PGHOST=$(echo "$DATABASE_URL" | sed 's/.*@\([^:]*\):.*/\1/')
export PGPORT=$(echo "$DATABASE_URL" | sed 's/.*:\([0-9]*\)\/.*/\1/')
export PGDATABASE=$(echo "$DATABASE_URL" | sed 's/.*\/\(.*\)/\1/')
export PGUSER=$(echo "$DATABASE_URL" | sed 's/.*:\/\/\([^:]*\):.*/\1/')
export PGPASSWORD=$(echo "$DATABASE_URL" | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/')

echo "📡 Connecting to PostgreSQL..."
echo "   Host: $PGHOST:$PGPORT"
echo "   Database: $PGDATABASE"
echo ""

# ─── Wait for Database ───────────────────────────────────────────────────────
echo "⏳ Waiting for database to be ready..."
for i in $(seq 1 30); do
  if psql -c "SELECT 1" >/dev/null 2>&1; then
    echo "✅ Database is ready"
    echo ""
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "❌ ERROR: Database connection timeout"
    exit 1
  fi
  sleep 2
done

# ─── Apply Schema ────────────────────────────────────────────────────────────
# schema-local.sql uses CREATE TABLE/INDEX IF NOT EXISTS throughout,
# so it is safe to apply on both fresh installs and existing databases.
# PGOPTIONS suppresses NOTICE messages ("relation already exists, skipping")
# while still surfacing real ERRORs.
echo "📦 Applying schema..."
PGOPTIONS='-c client_min_messages=warning' psql -f /schema.sql
echo "   ✓ Schema up to date"
echo ""

# ─── Seed Local Node ─────────────────────────────────────────────────────────
# instances.node_id FKs to nodes. Local mode uses a fixed mock node UUID
# (hardcoded in src/lib/nexus/client.ts getLocalNode()). Kubeconfig is not
# stored here — local mode always reads from KUBECONFIG_PATH file.
LOCAL_NODE_ID="11111111-1111-1111-1111-111111111111"
echo "🖥️  Checking local node..."
psql -c "INSERT INTO public.nodes (id, name, api_url, ip_address, kubeconfig, max_tenants, status)
         VALUES ('$LOCAL_NODE_ID', 'local', 'https://nexus-k3s:6443', '127.0.0.1', 'local-mode', 999, 'active')
         ON CONFLICT (id) DO NOTHING;" >/dev/null 2>&1
echo "   ✓ Local node ready"
echo ""

# ─── Create Dev User ─────────────────────────────────────────────────────────
DEV_USER_ID="00000000-0000-0000-0000-000000000000"

echo "👤 Checking dev user..."
if ! psql -tAc "SELECT id FROM public.users WHERE id='$DEV_USER_ID'" | grep -q "$DEV_USER_ID"; then
  echo "   → Creating dev user..."
  psql -c "INSERT INTO public.users (id, email, display_name, balance, flags) VALUES ('$DEV_USER_ID', 'dev@localhost', 'Local Dev User', 999.99, '{\"is_vip\": true, \"is_admin\": true}') ON CONFLICT (id) DO NOTHING;" >/dev/null 2>&1
  echo "   ✓ Dev user created"
else
  echo "   ✓ Dev user already exists"
fi
echo ""

# ─── Create Default API Key ──────────────────────────────────────────────────
echo "🔑 Checking default API key..."

# Check if a key already exists for dev user
EXISTING_KEY=$(psql -tAc "SELECT key_prefix FROM public.api_keys WHERE user_id='$DEV_USER_ID' LIMIT 1" | tr -d ' ')

if [ -n "$EXISTING_KEY" ]; then
  echo "   ✓ API key already exists (prefix: $EXISTING_KEY)"
  echo "   Note: Key is already created. If you need the full key, delete and re-run init."
else
  echo "   → Generating new API key..."
  
  # Generate random API key: nx_[32 hex chars]
  # Alpine doesn't have openssl, use /dev/urandom directly
  API_KEY="nx_$(dd if=/dev/urandom bs=16 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  
  # Hash the key with SHA-256
  KEY_HASH=$(echo -n "$API_KEY" | sha256sum | awk '{print $1}')
  
  # Extract prefix (first 8 chars)
  KEY_PREFIX="${API_KEY:0:8}"
  
  # Insert into database
  psql -c "INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix) VALUES ('$DEV_USER_ID', 'Local Default Key', '$KEY_HASH', '$KEY_PREFIX') ON CONFLICT (key_hash) DO NOTHING;" >/dev/null 2>&1
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✨ NEW API KEY GENERATED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Copy this key — it will NOT be shown again:"
  echo ""
  echo "    $API_KEY"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Add this to your Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):"
  echo ""
  echo '  "mcpServers": {'
  echo '    "nexus": {'
  echo '      "command": "curl",'
  echo '      "args": ['
  echo '        "-X", "POST",'
  echo '        "http://localhost:3000/api/mcp/v1",'
  echo '        "-H", "Content-Type: application/json",'
  echo '        "-H", "Accept: application/json, text/event-stream",'
  echo "        \"-H\", \"Authorization: Bearer $API_KEY\","
  echo '        "-d", "@-"'
  echo '      ]'
  echo '    }'
  echo '  }'
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  ✅ Initialization Complete"
echo "════════════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Visit http://localhost:3000/dashboard"
echo "  2. Configure Claude Desktop with the API key above"
echo "  3. Start deploying workloads!"
echo ""
