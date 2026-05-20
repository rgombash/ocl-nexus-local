import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logAction } from "@/lib/audit";
import { executeShellCommand } from "@/lib/nexus/ops/execute";
import { writeFile, writeFiles, readFile, listFiles, deleteFile } from "@/lib/nexus/ops/files";
import { getLogs } from "@/lib/nexus/ops/logs";
import { INFRA_DOMAIN } from "@/lib/config/nexus";
import { ok, err, resolveInstance, type McpCtx } from "../helpers";

export function registerSandboxTools(server: McpServer, ctx: McpCtx) {
  const { userId, keyId, audit } = ctx;

  // ── nexus_execute_command ─────────────────────────────────────────────────
  server.registerTool(
    "nexus_execute_command",
    {
      description:
        "Run a shell command inside a running pod. " +
        "Essential for: installing packages (pip3 install, npm install), " +
        "running scripts (python3 script.py, node app.js), checking environment, " +
        "reading output files. " +
        "Timeout: 30 s. Output cap: 5 MB. " +
        "Python: use 'python3' and 'pip3 install --break-system-packages'. " +
        "Node.js: use 'node', 'npm', 'pnpm'. " +
        "Working directory defaults to /app for sandboxes.",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        command: z
          .string()
          .describe(
            "Shell command to execute. Examples: 'python3 main.py', " +
              "'pip3 install requests --break-system-packages --quiet', " +
              "'ls -la /app', 'cat /app/output.json'"
          ),
        work_dir: z
          .string()
          .optional()
          .describe(
            "Working directory. Defaults to /app for sandboxes, /tmp for stateless workloads"
          ),
      },
    },
    async ({ instance_id, command, work_dir }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_execute_command",
          instance_id: instance.id,
          command: command.substring(0, 200),
          api_key_id: keyId,
        });
        const result = await executeShellCommand(instance, command, work_dir, audit);
        return ok(
          JSON.stringify(
            { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_write_file ──────────────────────────────────────────────────────
  server.registerTool(
    "nexus_write_file",
    {
      description:
        "Ship a file to the workload's 250 MB code volume (/app). " +
        "Files persist across nexus_restart calls. " +
        "Use this to upload application code, data files, or the nexus-start.sh " +
        "startup script (required for Service Mode). " +
        "Path is relative to /app (e.g. 'main.py', 'src/utils.py', 'nexus-start.sh').",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        path: z
          .string()
          .describe(
            "Relative path within /app. Examples: 'main.py', 'src/utils.py', 'nexus-start.sh'. " +
              "Directories are created automatically."
          ),
        content: z.string().describe("File content as a UTF-8 string"),
        encoding: z
          .enum(["utf8", "base64"])
          .optional()
          .default("utf8")
          .describe("Content encoding. Use 'base64' for binary files"),
      },
    },
    async ({ instance_id, path, content, encoding }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_write_file",
          instance_id: instance.id,
          path,
          api_key_id: keyId,
        });
        const result = await writeFile(instance, path, content, encoding ?? "utf8", audit);
        return ok(
          JSON.stringify(
            { path: result.path, fullPath: result.fullPath, message: "File written successfully" },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_write_files ─────────────────────────────────────────────────────
  server.registerTool(
    "nexus_write_files",
    {
      description:
        "Ship multiple files to the workload's code volume (/app) in a single call. " +
        "Prefer this over repeated nexus_write_file calls when uploading 2+ files — " +
        "it resolves in one tool call instead of N. " +
        "Files persist across nexus_restart calls. " +
        "Per-file errors are captured in results[] and do not abort the batch. " +
        "Check the 'failed' count in the response to detect partial failures.",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        files: z
          .array(
            z.object({
              path: z
                .string()
                .describe(
                  "Relative path within /app. Examples: 'main.py', 'src/utils.py', 'nexus-start.sh'. " +
                    "Directories are created automatically."
                ),
              content: z.string().describe("File content"),
              encoding: z
                .enum(["utf8", "base64"])
                .optional()
                .default("utf8")
                .describe("Content encoding. Use 'base64' for binary files. Default: utf8"),
            })
          )
          .min(1)
          .max(20)
          .describe("Files to upload (1–20 entries)"),
      },
    },
    async ({ instance_id, files }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_write_files",
          instance_id: instance.id,
          file_count: files.length,
          api_key_id: keyId,
        });
        const result = await writeFiles(
          instance,
          files.map((f) => ({ ...f, encoding: f.encoding ?? "utf8" })),
          audit
        );
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_read_file ───────────────────────────────────────────────────────
  server.registerTool(
    "nexus_read_file",
    {
      description:
        "Read a file from the workload's code volume (/app). " +
        "Use this to retrieve output files, logs written by scripts, config files, " +
        "or any artifact produced by nexus_execute_command. " +
        "Path is relative to /app.",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        path: z
          .string()
          .describe("Relative path within /app. Example: 'output.json', 'results/data.csv'"),
        encoding: z
          .enum(["utf8", "base64"])
          .optional()
          .default("utf8")
          .describe("Read encoding. Use 'base64' for binary files"),
      },
    },
    async ({ instance_id, path, encoding }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_read_file",
          instance_id: instance.id,
          path,
          api_key_id: keyId,
        });
        const result = await readFile(instance, path, encoding ?? "utf8", audit);
        return ok(
          JSON.stringify(
            { content: result.content, path: result.path, encoding: result.encoding },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_list_files ──────────────────────────────────────────────────────
  server.registerTool(
    "nexus_list_files",
    {
      description:
        "List files in the workload's code volume (/app). " +
        "Returns paths relative to /app, up to 3 directory levels deep. " +
        "Hidden files (dot-prefixed) are excluded. " +
        "Use this to verify files were written, inspect the workspace, " +
        "or find output artifacts after running a script.",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        dir_path: z
          .string()
          .optional()
          .describe(
            "Optional subdirectory to list (relative to /app). Omit to list all of /app"
          ),
      },
    },
    async ({ instance_id, dir_path }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_list_files",
          instance_id: instance.id,
          api_key_id: keyId,
        });
        const result = await listFiles(instance, dir_path, audit);
        return ok(
          JSON.stringify(
            { files: result.files, count: result.count, basePath: result.basePath },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_delete_file ─────────────────────────────────────────────────────
  server.registerTool(
    "nexus_delete_file",
    {
      description:
        "Delete a file or directory from the workload's code volume (/app). " +
        "Uses rm -rf — deletes directories recursively. " +
        "Cannot delete the /app root itself. " +
        "Path is relative to /app.",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        path: z
          .string()
          .describe(
            "Relative path within /app to delete. Example: 'old-script.py', 'cache/'"
          ),
      },
    },
    async ({ instance_id, path }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_delete_file",
          instance_id: instance.id,
          path,
          api_key_id: keyId,
        });
        const result = await deleteFile(instance, path, audit);
        return ok(
          JSON.stringify(
            { path: result.path, fullPath: result.fullPath, message: "File deleted successfully" },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_get_logs ────────────────────────────────────────────────────────
  server.registerTool(
    "nexus_get_logs",
    {
      description:
        "Retrieve container stdout/stderr logs for debugging. " +
        "Returns the last N lines from the running pod. " +
        "Note: nexus_execute_command output appears in the execute response, " +
        "not in container logs. Logs show: startup output, nexus-entrypoint.sh " +
        "messages, and output from nexus-start.sh (Service Mode).",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        tail_lines: z
          .number()
          .optional()
          .default(100)
          .describe("Number of log lines to retrieve (1–10000). Default: 100"),
      },
    },
    async ({ instance_id, tail_lines }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);
        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_get_logs",
          instance_id: instance.id,
          api_key_id: keyId,
        });
        const result = await getLogs(instance, tail_lines ?? 100, audit);
        return ok(
          JSON.stringify({ logs: result.logs, lineCount: result.lineCount ?? 0 }, null, 2)
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── nexus_fetch ───────────────────────────────────────────────────────────
  server.registerTool(
    "nexus_fetch",
    {
      description:
        "Make an authenticated HTTP request to a deployed service via its PUBLIC HTTPS URL and return the response. " +
        "Use this to health-check your service, verify API responses, or inspect what the app returns. " +
        "The caller's API key is forwarded as a Bearer token to the subdomain — " +
        "only instances you own are accessible. " +
        "The tool always succeeds; check statusCode in the result to detect app-level errors. " +
        "Response body is capped at 512 KB. " +
        "IMPORTANT: nexus_fetch always goes through the public URL (e.g. http://inst-{id}.localhost) — " +
        "it does NOT use internalUrl and cannot test pod-to-pod network reachability. " +
        "To verify internal connectivity between pods, use nexus_execute_command with: " +
        "curl -s --max-time 5 http://svc-{targetId}:80/path",
      inputSchema: {
        instance_id: z.string().describe("Instance UUID or short ID"),
        path: z
          .string()
          .describe(
            "URL path to request, including leading slash. Examples: '/health', '/api/users', '/?query=test'"
          ),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .default("GET")
          .describe("HTTP method. Default: GET"),
        body: z
          .string()
          .optional()
          .describe("Request body for POST/PUT/PATCH. Typically a JSON string."),
        content_type: z
          .string()
          .optional()
          .default("application/json")
          .describe("Content-Type header for the request. Default: application/json"),
      },
    },
    async ({ instance_id, path, method, body, content_type }) => {
      try {
        const instance = await resolveInstance(instance_id, userId);

        const targetUrl = `https://${instance.subdomain}.${INFRA_DOMAIN}${path}`;

        const reqHeaders: Record<string, string> = {
          Authorization: `Bearer ${ctx.apiKey}`,
          "Content-Type": content_type ?? "application/json",
        };

        const upstream = await fetch(targetUrl, {
          method: method ?? "GET",
          headers: reqHeaders,
          ...(body !== undefined ? { body } : {}),
          signal: AbortSignal.timeout(30_000),
        });

        const rawBody = await upstream.text();
        const truncated = rawBody.length > 512 * 1024;
        const responseBody = truncated ? rawBody.slice(0, 512 * 1024) : rawBody;
        const contentType = upstream.headers.get("content-type") ?? "text/plain";

        await logAction(userId, "MCP_TOOL_CALL", "success", {
          tool: "nexus_fetch",
          instance_id: instance.id,
          path,
          method: method ?? "GET",
          status_code: upstream.status,
          api_key_id: keyId,
        });

        return ok(
          JSON.stringify(
            {
              statusCode: upstream.status,
              contentType,
              body: responseBody,
              truncated,
              url: targetUrl,
            },
            null,
            2
          )
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
