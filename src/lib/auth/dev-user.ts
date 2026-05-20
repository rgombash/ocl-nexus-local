/**
 * OCL Nexus Local — Dev User Helper
 *
 * In local mode, there is only one user (the developer).
 * This helper provides a consistent user object for all operations.
 */

export interface DevUser {
  id: string;
  email: string;
  created_at: string;
}

/**
 * Get the dev user object.
 * In local mode, all requests are treated as authenticated with this user.
 */
export function getDevUser(): DevUser {
  const userId = process.env.LOCAL_DEV_USER_ID || "00000000-0000-0000-0000-000000000000";
  
  return {
    id: userId,
    email: "dev@localhost",
    created_at: new Date().toISOString(),
  };
}

/**
 * Check if we're running in local mode.
 */
export function isLocalMode(): boolean {
  return process.env.NEXUS_MODE === "local";
}
