/**
 * OCL Nexus Local — Authorization Helpers
 *
 * Centralized authorization logic that works in both cloud and local modes.
 * In local mode, all authorization checks are bypassed (free gas).
 */

import { hasFlag } from "@/lib/flags";
import { isLocalMode } from "./dev-user";

export interface UserProfile {
  balance?: number | string | null;
  flags?: Record<string, unknown> | null;
}

/**
 * Check if a user is authorized to perform operations.
 * 
 * Cloud mode: balance > 0 OR is_vip flag
 * Local mode: always authorized (billing bypassed)
 */
export function isAuthorized(profile: UserProfile | null): boolean {
  // Local mode: always authorized
  if (isLocalMode()) {
    return true;
  }

  // Cloud mode: check balance and VIP status
  if (!profile) return false;

  const isVip = hasFlag<boolean>(
    profile.flags as Record<string, unknown> | null | undefined,
    "is_vip",
    false
  ) === true;

  const balance = parseFloat(String(profile.balance ?? 0));

  return balance > 0 || isVip;
}

/**
 * Get authorization error message.
 * Returns null if authorized, error message otherwise.
 */
export function getAuthorizationError(profile: UserProfile | null): string | null {
  if (isAuthorized(profile)) {
    return null;
  }
  return "Not authorized.";
}
