/**
 * OCL Nexus — Centralized Platform Configuration
 *
 * This file defines global branding, domain, and infrastructure constants
 * for the OCL Nexus agentic workload platform.
 */

// ---------------------------------------------------------------------------
// Infrastructure Domain
// ---------------------------------------------------------------------------

/**
 * The root domain for the OCL Nexus infrastructure.
 * Used for tenant subdomains, API endpoints, cookies, and the app control plane.
 * Do NOT use for marketing URLs — use MARKETING_DOMAIN for those.
 *
 * Examples:
 * - Cloud: app.oclhosting.com, inst-a1b2c3d4.oclhosting.com, .oclhosting.com
 * - Local: app.localhost, inst-a1b2c3d4.localhost, .localhost
 *
 * Set via INFRA_DOMAIN environment variable.
 */
export const INFRA_DOMAIN = process.env.INFRA_DOMAIN || "oclhosting.com";

/**
 * The marketing and docs domain (new brand).
 * Homepage and /docs live here; all auth and APIs remain on INFRA_DOMAIN.
 */
export const MARKETING_DOMAIN = "oclnexus.com";

/**
 * Full URLs for key platform components.
 */
export const PLATFORM_URLS = {
  marketing: `https://${MARKETING_DOMAIN}`,
  docs: `https://${MARKETING_DOMAIN}/docs`,
  app: `https://app.${INFRA_DOMAIN}`,
  support: `mailto:support@${MARKETING_DOMAIN}`,
} as const;

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

/**
 * Platform branding constants.
 */
export const PLATFORM_BRANDING = {
  name: "OCL Nexus",
  tagline: "Agentic Workload Platform",
  company: "OCL Nexus Local",
} as const;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Generate a tenant subdomain for an instance.
 * @param shortId - The short ID (UUID without hyphens) for the instance
 * @returns The full subdomain (e.g., "inst-a1b2c3d4.oclhosting.com")
 */
export function getTenantSubdomain(shortId: string): string {
  return `inst-${shortId}.${INFRA_DOMAIN}`;
}

/**
 * Generate a Kubernetes namespace name for a tenant (LEGACY).
 * @param shortId - The short ID for the instance
 * @returns The namespace name (e.g., "tenant-a1b2c3d4")
 * @deprecated Use getUserNamespace() for new deployments
 */
export function getTenantNamespace(shortId: string): string {
  return `tenant-${shortId}`;
}

/**
 * Generate a Kubernetes namespace name for a user (Milestone 2 Phase 2+).
 * One namespace per user, all instances share it.
 * @param userId - The Supabase user UUID
 * @returns The namespace name (e.g., "u-a1b2c3d4")
 */
export function getUserNamespace(userId: string): string {
  const prefix = userId.replace(/-/g, "").substring(0, 8);
  return `u-${prefix}`;
}

/**
 * Extract short ID from a subdomain string.
 * @param subdomain - The subdomain (e.g., "inst-a1b2c3d4")
 * @returns The short ID without the "inst-" prefix
 */
export function extractShortId(subdomain: string): string {
  return subdomain.replace("inst-", "");
}
