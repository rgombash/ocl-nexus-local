/**
 * JSONB feature-flag helpers
 *
 * Flags are stored as a JSONB column (`flags`) on `public.users`.
 * Values can be boolean, string, or number — all accessed via `hasFlag`.
 */

type FlagsMap = Record<string, unknown> | null | undefined;

/**
 * Returns the value of a flag, or `defaultValue` if the flag is absent /
 * the map is null/undefined.
 */
export function hasFlag<T = boolean>(
  flags: FlagsMap,
  flagName: string,
  defaultValue: T
): T {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return defaultValue;
  }
  return flagName in flags ? (flags[flagName] as T) : defaultValue;
}
