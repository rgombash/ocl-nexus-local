-- ═══════════════════════════════════════════════════════════════════════════
-- OCL Nexus Local — Simplified Schema (No Supabase Dependencies)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper Function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Nodes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  api_url TEXT NOT NULL,
  ip_address TEXT,
  kubeconfig TEXT NOT NULL,
  current_tenant_count INTEGER NOT NULL DEFAULT 0,
  max_tenants INTEGER NOT NULL DEFAULT 999,
  is_staging_node BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER nodes_updated_at
  BEFORE UPDATE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS idx_nodes_status ON public.nodes(status);

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  balance NUMERIC(12,8) NOT NULL DEFAULT 0.00000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_instances SMALLINT NOT NULL DEFAULT 5
);

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at);

-- ─── Tenant Configs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  provider_keys JSONB,
  setup_scripts TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER tenant_configs_updated_at
  BEFORE UPDATE ON public.tenant_configs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS idx_tenant_configs_user_id ON public.tenant_configs(user_id);

-- ─── Transactions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,8) NOT NULL,
  type TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type);

-- ─── Config Sets ─────────────────────────────────────────────────────────────
-- Must be defined before instances (instances.config_set_id references this)
CREATE TABLE IF NOT EXISTS public.config_sets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_set_name UNIQUE (user_id, name)
);

CREATE OR REPLACE TRIGGER config_sets_updated_at
  BEFORE UPDATE ON public.config_sets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS idx_config_sets_user_id ON public.config_sets(user_id);

-- ─── Instances ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.nodes(id) ON DELETE RESTRICT,
  subdomain TEXT NOT NULL UNIQUE,
  gateway_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blueprint_id TEXT NOT NULL DEFAULT 'openclaw',
  user_description TEXT,
  config_set_id UUID REFERENCES public.config_sets(id) ON DELETE SET NULL
);

CREATE OR REPLACE TRIGGER instances_updated_at
  BEFORE UPDATE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS idx_instances_user_id ON public.instances(user_id);
CREATE INDEX IF NOT EXISTS idx_instances_node_id ON public.instances(node_id);
CREATE INDEX IF NOT EXISTS idx_instances_status ON public.instances(status);
CREATE INDEX IF NOT EXISTS idx_instances_subdomain ON public.instances(subdomain);
CREATE INDEX IF NOT EXISTS idx_instances_created_at ON public.instances(created_at);
CREATE INDEX IF NOT EXISTS idx_instances_config_set_id ON public.instances(config_set_id);

-- ─── Audit Logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failure')),
  metadata JSONB NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

-- ─── Backups ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.instances(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_user_id ON public.backups(user_id);
CREATE INDEX IF NOT EXISTS idx_backups_instance_id ON public.backups(instance_id);
CREATE INDEX IF NOT EXISTS idx_backups_status ON public.backups(status);
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON public.backups(created_at);

-- ─── Usage Burn ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_burn (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.instances(id) ON DELETE SET NULL,
  amount NUMERIC(12,8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_burn_user_id ON public.usage_burn(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_burn_instance_id ON public.usage_burn(instance_id);
CREATE INDEX IF NOT EXISTS idx_usage_burn_created_at ON public.usage_burn(created_at);

-- ─── Config Variables ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.config_variables (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id     UUID        NOT NULL REFERENCES public.config_sets(id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      TEXT        NOT NULL,  -- AES-256-GCM encrypted via lib/encryption.ts
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_set_key UNIQUE (set_id, key)
);

CREATE OR REPLACE TRIGGER config_variables_updated_at
  BEFORE UPDATE ON public.config_variables
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS idx_config_variables_set_id ON public.config_variables(set_id);

-- ─── API Keys ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,  -- SHA-256 hash; plaintext never stored
  key_prefix   TEXT        NOT NULL,         -- First 8 chars for UI display
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON public.api_keys(key_prefix);

-- ═══════════════════════════════════════════════════════════════════════════
-- End of Schema
-- ═══════════════════════════════════════════════════════════════════════════
