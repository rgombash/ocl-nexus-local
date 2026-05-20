/**
 * AES-256-GCM encryption helpers for sensitive DB values (e.g. API keys).
 *
 * Storage format:  <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *   iv       = 12 bytes  → 24 hex chars
 *   authTag  = 16 bytes  → 32 hex chars
 *
 * Environment variable: ENCRYPTION_KEY — exactly 32 ASCII characters.
 *
 * Migration safety: `decrypt()` returns the input unchanged when it is NOT
 * in the expected format, so existing plain-text rows keep working until
 * they are re-saved through the normal save flow.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm" as const;

// Matches  <24-hex>:<32-hex>:<1+-hex>
const ENCRYPTED_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY environment variable must be exactly 32 characters"
    );
  }
  return Buffer.from(key, "utf8");
}

/** Returns true when `value` is already in the encrypted storage format. */
export function isEncrypted(value: string): boolean {
  return ENCRYPTED_RE.test(value);
}

/**
 * Encrypts `plaintext` and returns the `iv:authTag:ciphertext` hex string.
 * Always produces a fresh random IV — never reuses one.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit IV — recommended for GCM
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 16 bytes
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a value previously produced by `encrypt()`.
 *
 * If `hash` is NOT in the encrypted format it is returned as-is — this
 * handles rows that were saved before encryption was introduced.
 */
export function decrypt(hash: string): string {
  if (!isEncrypted(hash)) {
    // Plain-text passthrough for migration compatibility
    return hash;
  }
  const [ivHex, tagHex, dataHex] = hash.split(":");
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
