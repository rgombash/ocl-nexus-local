// ---------------------------------------------------------------------------
// Command Registry — Openclaw CLI Remote Execution
//
// Maps well-known action keys to approved CLI command templates.
// Use {{paramName}} placeholders for runtime-substituted values.
//
// All exec API calls MUST go through resolveCommand() — arbitrary shell
// strings are never accepted.
// ---------------------------------------------------------------------------

export type CommandKey = "CHANNEL_STATUS" | "CHANNEL_LOGIN";

interface CommandTemplate {
  /** Token array — {{placeholder}} values are substituted at call time */
  template: string[];
  /**
   * Optional per-command exec timeout in ms.
   * When the command is expected to block after producing output (e.g. interactive
   * login flows that print a QR then wait for scan), set a short timeout so the
   * route resolves with the accumulated output instead of waiting indefinitely.
   * Defaults to EXEC_TIMEOUT_MS (20 s) in exec-utils when unset.
   */
  timeoutMs?: number;
  /**
   * Allocate a PTY for this command.
   * Required when the process checks isatty(1) before flushing output — e.g.
   * interactive login flows buffer stdout when it's a pipe but flush immediately
   * to a terminal. Without tty:true the QR bytes never arrive before the timeout.
   */
  tty?: boolean;
}

export const COMMAND_REGISTRY: Record<CommandKey, CommandTemplate> = {
  /** Return JSON with per-channel connection state */
  CHANNEL_STATUS: {
    template: ["openclaw", "channels", "status", "--json"],
  },
  /** Initiate login flow for a specific channel (prints QR / pairing string).
   *  Wrapped with 'timeout 25' so the process is guaranteed dead in the container
   *  within 25s regardless of WebSocket/SIGHUP delivery from our side.
   *  Observed sequence: banner ~4s, 10s pause, QR render. Quiet timer resolves
   *  at ~17s; user scans; session saved before timeout kills at t=25s. */
  CHANNEL_LOGIN: {
    template: ["timeout", "25", "openclaw", "channels", "login", "--channel", "{{channel}}"],
    timeoutMs: 30000,
    tty: true,
  },
};

/**
 * Resolve a registry key + params into a concrete argv array.
 *
 * @throws if key is not in the registry or a required placeholder is missing.
 */
export function resolveCommand(
  key: string,
  params: Record<string, string> = {}
): string[] {
  if (!(key in COMMAND_REGISTRY)) {
    throw new Error(`Unknown command key: ${key}`);
  }
  const { template } = COMMAND_REGISTRY[key as CommandKey];
  return template.map((token) =>
    token.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
      if (!(name in params)) {
        throw new Error(`Missing required param '${name}' for command '${key}'`);
      }
      return params[name];
    })
  );
}
