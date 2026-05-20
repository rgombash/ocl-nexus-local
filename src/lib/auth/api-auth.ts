/**
 * Nexus API Key Authentication Utilities
 *
 * Generates and validates API keys for machine-to-machine authentication.
 * Keys follow the format: nx_[32_hex_chars] (e.g., "nx_a1b2c3d4e5f6...")
 *
 * Security:
 * - Keys are hashed using SHA-256 before storage (one-way, no decryption)
 * - Plaintext keys are NEVER stored in the database
 * - Keys are shown to users only once during creation
 * - Last used timestamp updated on successful validation
 *
 * Note: Uses Web Crypto API for Edge Runtime compatibility (middleware uses this)
 */

import { supabaseAdmin } from "@/lib/supabase-admin";

const KEY_PREFIX = "nx_";

export interface ApiKeyData {
  key: string; // Full plaintext key (e.g., "nx_a1b2c3d4e5f6...")
  prefix: string; // First 8 chars for UI display (e.g., "nx_a1b2c")
  hash: string; // SHA-256 hash for storage
}

export interface ValidatedKey {
  userId: string;
  keyId: string;
}

/**
 * Generates a new API key with hash and prefix.
 *
 * Returns an object containing:
 * - `key`: Full plaintext key (show to user ONCE, then discard)
 * - `prefix`: First 8 chars for UI display
 * - `hash`: SHA-256 hash to store in database
 *
 * @returns {Promise<ApiKeyData>} Object with key, prefix, and hash
 */
export async function generateApiKey(): Promise<ApiKeyData> {
  // Generate 16 random bytes → 32 hex characters (using Web Crypto API)
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `${KEY_PREFIX}${randomHex}`;

  // Extract prefix for UI display (first 8 chars)
  const prefix = key.substring(0, 8);

  // Hash the key for storage (SHA-256)
  const hash = await hashApiKey(key);

  return { key, prefix, hash };
}

/**
 * Hashes an API key using SHA-256 (Web Crypto API for Edge Runtime compatibility).
 *
 * @param key - The plaintext API key
 * @returns {string} Hex-encoded SHA-256 hash
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

/**
 * Validates an API key from a Bearer token.
 *
 * Flow:
 * 1. Hash the provided token
 * 2. Look up the hash in the api_keys table
 * 3. If found, update last_used_at timestamp
 * 4. Return user_id and key_id for downstream use
 *
 * @param bearerToken - The raw token from Authorization header (e.g., "nx_a1b2c3d4...")
 * @returns {Promise<ValidatedKey | null>} User and key IDs if valid, null otherwise
 */
export async function validateApiKey(
  bearerToken: string
): Promise<ValidatedKey | null> {
  // Quick format check: must start with nx_ and be correct length
  if (!bearerToken.startsWith(KEY_PREFIX)) {
    return null;
  }

  // Hash the token to compare against stored hashes
  const hash = await hashApiKey(bearerToken);

  // Look up the key in the database
  const { data: apiKey, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !apiKey) {
    return null;
  }

  // Update last_used_at timestamp (fire-and-forget — don't block the request)
  void supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then((result) => {
      if (result.error) {
        console.error("[api-auth] Failed to update last_used_at:", result.error);
      }
    });

  return {
    userId: apiKey.user_id,
    keyId: apiKey.id,
  };
}
