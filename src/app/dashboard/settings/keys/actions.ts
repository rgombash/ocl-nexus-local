"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateApiKey } from "@/lib/auth/api-auth";
import { logAction } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CreateKeyResult {
  ok: boolean;
  key?: string; // Full key returned ONLY on creation (never again)
  prefix?: string; // For UI display
  error?: string;
}

export interface RevokeKeyResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Create API Key
//
// Generates a new API key, stores the hash, and returns the full key ONCE.
// ---------------------------------------------------------------------------
export async function createApiKey(
  name: string
): Promise<CreateKeyResult> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  // ── Validation ──────────────────────────────────────────────────────────
  const trimmedName = name.trim();

  if (!trimmedName) {
    return { ok: false, error: "Key name is required" };
  }

  if (trimmedName.length > 50) {
    return { ok: false, error: "Key name must be 50 characters or less" };
  }

  // ── Generate key ────────────────────────────────────────────────────────
  const { key, prefix, hash } = await generateApiKey();

  // ── Store in database ───────────────────────────────────────────────────
  const { error: insertError } = await supabaseAdmin
    .from("api_keys")
    .insert({
      user_id: user.id,
      name: trimmedName,
      key_hash: hash,
      key_prefix: prefix,
    });

  if (insertError) {
    console.error("[createApiKey] Insert failed:", insertError);
    return { ok: false, error: "Failed to create API key" };
  }

  // ── Audit log ───────────────────────────────────────────────────────────
  await logAction(user.id, "API_KEY_CREATE", "success", {
    name: trimmedName,
    prefix,
  });

  // ── Return full key ONCE ────────────────────────────────────────────────
  return { ok: true, key, prefix };
}

// ---------------------------------------------------------------------------
// Revoke API Key
//
// Deletes an API key from the database (permanent action).
// ---------------------------------------------------------------------------
export async function revokeApiKey(
  keyId: string
): Promise<RevokeKeyResult> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  // ── Verify ownership ────────────────────────────────────────────────────
  const { data: apiKey, error: fetchError } = await supabaseAdmin
    .from("api_keys")
    .select("user_id, name, key_prefix")
    .eq("id", keyId)
    .maybeSingle();

  if (fetchError || !apiKey) {
    return { ok: false, error: "API key not found" };
  }

  if (apiKey.user_id !== user.id) {
    return { ok: false, error: "Unauthorized" };
  }

  // ── Delete key ──────────────────────────────────────────────────────────
  const { error: deleteError } = await supabaseAdmin
    .from("api_keys")
    .delete()
    .eq("id", keyId);

  if (deleteError) {
    console.error("[revokeApiKey] Delete failed:", deleteError);
    return { ok: false, error: "Failed to revoke API key" };
  }

  // ── Audit log ───────────────────────────────────────────────────────────
  await logAction(user.id, "API_KEY_REVOKE", "success", {
    name: apiKey.name,
    prefix: apiKey.key_prefix,
  });

  return { ok: true };
}
