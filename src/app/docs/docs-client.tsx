"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  PLAYBOOK_CONTENT,
  CLAUDE_DESKTOP_CONFIG,
  CLAUDE_CODE_CONFIG,
  CLAUDE_MD_TEMPLATE,
  CURSOR_CONFIG,
  CONTINUE_CONFIG,
  WHY_NEXUS,
  MCP_ENDPOINT,
  DUAL_SETUP_NOTE,
} from "@/lib/docs/content";

type MainTab = "handbook" | "playbook";

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-b-lg border border-gray-200 bg-gray-950 p-4 text-sm leading-relaxed text-gray-100 dark:border-gray-700">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step component
// ---------------------------------------------------------------------------

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
        {number}
      </div>
      <div className="flex-1 pb-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verify connection callout
// ---------------------------------------------------------------------------

function VerifyCallout() {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-900/20">
      <p className="text-sm text-green-900 dark:text-green-300">
        <strong>Verify it works:</strong> ask your agent to call{" "}
        <span className="font-mono text-xs">nexus_list_workloads</span> — if it returns a JSON response with a{" "}
        <span className="font-mono text-xs">workloads</span> array (empty or not), the MCP connection is live.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform sections data
// ---------------------------------------------------------------------------

const PLATFORMS = [
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "claude-code",    label: "Claude Code"    },
  { id: "cursor",         label: "Cursor"         },
  { id: "continue",       label: "Continue.dev"   },
] as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DocsClient() {
  const [mainTab, setMainTab] = useState<MainTab>("handbook");
  const [activeSection, setActiveSection] = useState<string>("claude-desktop");

  // Scrollspy — highlight the anchor pill matching the section nearest the top
  useEffect(() => {
    if (mainTab !== "handbook") return;

    const observers: IntersectionObserver[] = [];

    PLATFORMS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        // Section becomes "active" when it enters the top 40% of the viewport
        { threshold: 0, rootMargin: "0px 0px -60% 0px" }
      );
      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [mainTab]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* Hero */}
      <div className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Documentation
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            OCL Nexus Local
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
            Everything you need to connect your AI agent to the local compute fabric.
          </p>
        </div>
      </div>

      {/* Main tab bar */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 pt-2" aria-label="Tabs">
            {(["handbook", "playbook"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                  mainTab === tab
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {tab === "handbook" ? "📖 The Handbook" : "🤖 The Playbook"}
                {mainTab === tab && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">

        {/* ── HANDBOOK TAB ── */}
        {mainTab === "handbook" && (
          <div className="space-y-12">

            {/* Why Nexus Local */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">What is OCL Nexus Local?</h2>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-900/20">
                <p className="text-sm leading-relaxed text-blue-900 dark:text-blue-200">{WHY_NEXUS}</p>
              </div>
            </section>

            {/* Quick Start */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Quick Start</h2>
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <Step number={1} title="Start the stack">
                  <p>
                    Run <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">docker compose up -d</code> in
                    the repo root. The dashboard will be available at{" "}
                    <Link href="/dashboard" className="text-blue-600 hover:underline dark:text-blue-400">
                      localhost:3000/dashboard
                    </Link>{" "}
                    — no login required.
                  </p>
                </Step>
                <Step number={2} title="Get your API key">
                  <p>
                    Your API key is printed to logs on first run:{" "}
                    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">docker compose logs nexus-init | grep nx_</code>.
                    You can also create additional keys at{" "}
                    <Link href="/dashboard/settings/keys" className="text-blue-600 hover:underline dark:text-blue-400">
                      Dashboard → API Keys
                    </Link>.{" "}
                    Keys start with <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">nx_</code>.{" "}
                    Never commit them to source control.
                  </p>
                </Step>
                <Step number={3} title="Connect your IDE or agent">
                  <p>
                    Paste your key into the config for your tool below. Your agent can then call all
                    15 Nexus MCP tools to deploy sandboxes, upload code, run services, and verify
                    they&apos;re responding — all on your local K3s cluster.
                  </p>
                </Step>
              </div>
            </section>

            {/* Quick & Dirty */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Quick &amp; Dirty</h2>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                  If you are using any modern agentic harness, you can try configuring it using a prompt. Get your API key and ask your agent something like this:
                </p>
                <blockquote className="mt-4 border-l-4 border-amber-400 pl-4 italic text-sm leading-relaxed text-amber-800 dark:border-amber-600 dark:text-amber-300">
                  &ldquo;Please read the documentation at https://oclnexus.com/docs and the agent playbook at https://oclnexus.com/docs/playbook. Set up the OCL MCP connection and create a CLAUDE.md (or equivalent) in this project using the starter template from the docs.&rdquo;
                </blockquote>
              </div>
            </section>

            {/* ── Connect Your IDE ── */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Connect Your IDE</h2>
              <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
                OCL Nexus exposes a{" "}
                <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                  Model Context Protocol
                </a>{" "}
                server at{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">{MCP_ENDPOINT}</code>.
              </p>

              <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                <strong>Transport notes:</strong>
                <ul className="mt-1 list-disc pl-5 space-y-1">
                  <li>Clients must send <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-700">Accept: application/json, text/event-stream</code> — requests without this header will be rejected.</li>
                  <li>Responses use SSE framing (<code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-700">data: {"{...}"}</code>). MCP-compliant clients handle this automatically; custom clients must parse the <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-700">data:</code> line.</li>
                </ul>
              </div>

              {/* Anchor pill navigation */}
              <nav aria-label="IDE platforms" className="flex flex-wrap gap-2 mb-8">
                {PLATFORMS.map(({ id, label }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      activeSection === id
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}
                  >
                    {label}
                  </a>
                ))}
              </nav>

              {/* ── Claude Desktop ── */}
              <div id="claude-desktop" className="scroll-mt-20 space-y-4 py-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Claude Desktop</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Open <strong>Claude Desktop → Settings → Developer → Edit Config</strong> and add
                  the following to your{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">claude_desktop_config.json</code>.
                  Replace <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">YOUR_API_KEY</code> with your key from the{" "}
                  <Link href="/dashboard/settings/keys" className="text-blue-600 hover:underline dark:text-blue-400">API Keys page</Link>.
                </p>
                <CodeBlock code={CLAUDE_DESKTOP_CONFIG} language="json" />
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  File: <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">claude_desktop_config.json</code>
                </p>
                <VerifyCallout />
              </div>

              {/* ── Claude Code ── */}
              <div id="claude-code" className="scroll-mt-20 space-y-4 py-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Claude Code</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Add the following to{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">~/.claude/settings.json</code> (global) or{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">.claude/settings.json</code> (per-project).
                  Replace <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">YOUR_API_KEY</code> with your key from the{" "}
                  <Link href="/dashboard/settings/keys" className="text-blue-600 hover:underline dark:text-blue-400">API Keys page</Link>.
                </p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="text-sm text-amber-900 dark:text-amber-300">
                    <strong>Required:</strong> the{" "}
                    <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/50">&quot;type&quot;: &quot;http&quot;</code>{" "}
                    field is mandatory for Claude Code and silently fails without it.
                    Claude Desktop does not need this field.
                  </p>
                </div>
                <CodeBlock code={CLAUDE_CODE_CONFIG} language="json" />
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  File: <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">~/.claude/settings.json</code> or{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">.claude/settings.json</code>
                </p>
                <VerifyCallout />

                {/* CLAUDE.md template */}
                <div className="pt-2 space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Add a <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">CLAUDE.md</code> to your project{" "}
                      <span className="font-normal text-gray-500 dark:text-gray-400">(recommended)</span>
                    </h4>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Claude Code reads <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">CLAUDE.md</code> at
                      the project root on every session. This starter gives your agent the key rules
                      without re-discovering them.
                    </p>
                  </div>
                  <CodeBlock code={CLAUDE_MD_TEMPLATE} language="markdown" />
                </div>
              </div>

              {/* ── Cursor ── */}
              <div id="cursor" className="scroll-mt-20 space-y-4 py-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cursor</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Open <strong>Cursor → Settings → MCP</strong>, or create{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">.cursor/mcp.json</code> in your
                  project root. Replace{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">YOUR_API_KEY</code> with your key from the{" "}
                  <Link href="/dashboard/settings/keys" className="text-blue-600 hover:underline dark:text-blue-400">API Keys page</Link>.
                </p>
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
                  <p className="text-sm text-red-900 dark:text-red-300">
                    <strong>Security:</strong>{" "}
                    <code className="rounded bg-red-100 px-1 py-0.5 text-xs dark:bg-red-900/50">.cursor/mcp.json</code> lives inside
                    your project directory and can be accidentally committed to git. Either add it to{" "}
                    <code className="rounded bg-red-100 px-1 py-0.5 text-xs dark:bg-red-900/50">.gitignore</code>, or use{" "}
                    <strong>Cursor → Settings → MCP</strong> (global config) to keep your API key outside the repo.
                  </p>
                </div>
                <CodeBlock code={CURSOR_CONFIG} language="json" />
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  File: <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">.cursor/mcp.json</code>
                </p>
                <VerifyCallout />
              </div>

              {/* ── Continue.dev ── */}
              <div id="continue" className="scroll-mt-20 space-y-4 py-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Continue.dev</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Merge the following into{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">~/.continue/config.json</code>.
                  Replace{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">YOUR_API_KEY</code> with your key from the{" "}
                  <Link href="/dashboard/settings/keys" className="text-blue-600 hover:underline dark:text-blue-400">API Keys page</Link>.
                </p>
                <CodeBlock code={CONTINUE_CONFIG} language="json" />
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  File: <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">~/.continue/config.json</code>
                </p>
                <VerifyCallout />
              </div>
            </section>

            {/* Instance Endpoint Access */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <svg className="h-5 w-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                Instance Endpoint Access
              </h2>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-800/60">
                <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  Workload endpoints (e.g.{" "}
                  <code className="rounded bg-gray-200 px-1 py-0.5 text-xs dark:bg-gray-700">http://inst-xxxx.localhost</code>
                  ) are protected by your API key via Traefik ForwardAuth. Only requests with a valid{" "}
                  <code className="rounded bg-gray-200 px-1 py-0.5 text-xs dark:bg-gray-700">Authorization: Bearer nx_...</code>{" "}
                  header, or an active dashboard session, can reach them.
                </p>
              </div>
            </section>

            {/* Running local + cloud simultaneously */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Using Local and Cloud Together</h2>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 dark:border-indigo-800 dark:bg-indigo-900/20">
                <p className="text-sm leading-relaxed text-indigo-900 dark:text-indigo-200">{DUAL_SETUP_NOTE}</p>
                <div className="mt-4">
                  <CodeBlock code={`{
  "mcpServers": {
    "ocl-nexus-local": {
      "url": "http://localhost:3000/api/mcp/v1",
      "headers": { "Authorization": "Bearer YOUR_LOCAL_KEY" }
    },
    "ocl-nexus": {
      "url": "https://app.oclhosting.com/api/mcp/v1",
      "headers": { "Authorization": "Bearer YOUR_CLOUD_KEY" }
    }
  }
}`} language="json — side-by-side config" />
                </div>
                <p className="mt-3 text-xs text-indigo-700 dark:text-indigo-400">
                  Cloud platform: <a href="https://oclnexus.com" target="_blank" rel="noopener noreferrer" className="underline">oclnexus.com</a>
                </p>
              </div>
            </section>

            {/* Troubleshooting */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Troubleshooting</h2>
              <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Symptom</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Likely cause</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Fix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-700 dark:bg-gray-800">
                    {[
                      {
                        symptom: "nexus_* tools not found",
                        cause: "MCP server not loaded",
                        fix: "Check config file path and restart your IDE. For Claude Code, confirm \"type\": \"http\" is present.",
                      },
                      {
                        symptom: "nexus_list_workloads returns auth error",
                        cause: "Invalid or expired API key",
                        fix: "Generate a new key in Dashboard → API Keys. Keys are shown only once.",
                      },
                      {
                        symptom: "nexus_fetch returns connection refused",
                        cause: "Service not running or wrong port",
                        fix: "Confirm nexus_wait_for_ready completed. Check port binding: 8000 for python-sandbox, 3000 for nodejs-sandbox.",
                      },
                      {
                        symptom: "nexus_fetch works but internal curl fails",
                        cause: "Using public URL for pod-to-pod call",
                        fix: "Use nexus_execute_command + curl http://svc-<id>:80 for internal connectivity tests.",
                      },
                      {
                        symptom: "Workload never becomes ready",
                        cause: "Service crashed on startup",
                        fix: "Check nexus_get_logs for errors. Verify nexus-start.sh is executable and exits on error (set -e).",
                      },
                    ].map((row, i) => (
                      <tr key={i} className="align-top">
                        <td className="px-4 py-3 font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap">{row.symptom}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.cause}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.fix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        )}

        {/* ── PLAYBOOK TAB ── */}
        {mainTab === "playbook" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Agent Playbook</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Copy this into your agent&apos;s system prompt, Cursor Rules, or{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">.cursorrules</code> file.
                  It teaches your agent how to use OCL Nexus effectively.
                </p>
              </div>
              <div className="shrink-0">
                <CopyButton text={PLAYBOOK_CONTENT} label="Copy Playbook" />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">SKILLS.md — Agent Playbook</span>
                <CopyButton text={PLAYBOOK_CONTENT} label="Copy Playbook" />
              </div>
              <pre className="overflow-x-auto bg-gray-950 p-6 text-sm leading-relaxed text-gray-100">
                <code>{PLAYBOOK_CONTENT}</code>
              </pre>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-1">
                Also available as an MCP resource
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-400">
                Your agent can read the playbook directly via the{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/50">nexus://skills</code> MCP resource
                — no copy-paste needed when using Claude Desktop, Cursor, or Continue.dev.
              </p>
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 py-8 mt-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500 dark:text-gray-500">
          <p>OCL Nexus Local — open-source. Cloud platform at <a href="https://oclnexus.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-300">oclnexus.com</a>.</p>
          <div className="flex gap-4">
            <Link href="/dashboard" className="hover:text-gray-700 dark:hover:text-gray-300">Dashboard</Link>
            <Link href="/dashboard/settings/keys" className="hover:text-gray-700 dark:hover:text-gray-300">API Keys</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
