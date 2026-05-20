"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// TerminalModal
//
// Reusable modal that renders CLI output in a styled terminal (black bg,
// monospace font). Designed for ASCII QR codes — font-size is intentionally
// small (10px) with line-height:1 and letter-spacing:0 so QR blocks align.
//
// When pollForConnection=true and an instanceId is supplied, the component
// polls GET /api/instances/:instanceId/status every 3 seconds. If the
// response returns whatsappStatus === 'connected' it shows a success message
// and auto-closes after 1.5 s.
// ---------------------------------------------------------------------------

export interface TerminalModalProps {
  /** Controls visibility */
  isOpen: boolean;
  /** Title bar label */
  title: string;
  /** Pre-rendered output to display (e.g. QR code string from exec) */
  output?: string;
  /**
   * When true, polls the status API and closes on WhatsApp 'connected'.
   * Requires instanceId to be set.
   */
  pollForConnection?: boolean;
  /** Instance UUID — required when pollForConnection is true */
  instanceId?: string;
  /** Called when the modal should close */
  onClose: () => void;
  /** Called when the status API reports whatsappStatus === 'connected' */
  onConnected?: () => void;
}

export default function TerminalModal({
  isOpen,
  title,
  output = "",
  pollForConnection = false,
  instanceId,
  onClose,
  onConnected,
}: TerminalModalProps) {
  const [connected, setConnected] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll to bottom when output changes (e.g. streaming lines appended)
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [output]);

  // Poll for WhatsApp connection status while modal is open
  // Uses the /execute endpoint (CHANNEL_STATUS) — not the background status poll —
  // so it never delays the pod-status check that gates the dashboard buttons.
  useEffect(() => {
    if (!isOpen || !pollForConnection || !instanceId) return;

    let currentController: AbortController | null = null;

    const poll = async () => {
      // Cancel any previous in-flight request before starting a new one
      currentController?.abort();
      currentController = new AbortController();
      try {
        const res = await fetch(`/api/instances/${instanceId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionKey: "CHANNEL_STATUS" }),
          signal: currentController.signal,
        });
        if (!res.ok) return;
        const data: { ok?: boolean; output?: string } = await res.json();
        if (!data.ok || !data.output) return;
        const channels = JSON.parse(data.output) as Record<
          string,
          { state?: string; status?: string }
        >;
        const waState = (
          channels?.whatsapp?.state ??
          channels?.whatsapp?.status ??
          ""
        ).toLowerCase();
        if (waState === "connected") {
          setConnected(true);
          if (intervalRef.current) clearInterval(intervalRef.current);
          onConnected?.();
          setTimeout(onClose, 1500);
        }
      } catch {
        // Ignore transient errors and AbortError during polling
      }
    };

    intervalRef.current = setInterval(poll, 3000);
    return () => {
      currentController?.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOpen, pollForConnection, instanceId, onConnected, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setConnected(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => {
        // Close when clicking the backdrop
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg overflow-hidden shadow-2xl border border-gray-700 flex flex-col">
        {/* ── Title bar ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between bg-gray-800 px-4 py-2 select-none">
          <span className="text-sm font-mono text-gray-200">{title}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
            aria-label="Close terminal"
          >
            ✕
          </button>
        </div>

        {/* ── Terminal body ─────────────────────────────────────────────── */}
        <div className="bg-black p-3">
          {connected ? (
            <p className="text-green-400 text-sm text-center py-6 font-mono">
              ✓ WhatsApp connected successfully!
            </p>
          ) : (
            <pre
              ref={preRef}
              className="text-white overflow-auto max-h-[70vh]"
              style={{
                fontFamily:
                  '"JetBrains Mono", "Roboto Mono", Courier, monospace',
                fontSize: "10px",
                lineHeight: 1,
                letterSpacing: 0,
                whiteSpace: "pre",
                margin: 0,
              }}
            >
              {output || ""}
            </pre>
          )}
        </div>

        {/* ── Status bar (visible while polling) ───────────────────────── */}
        {pollForConnection && !connected && (
          <div className="bg-gray-900 px-4 py-1.5 border-t border-gray-700">
            <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              Waiting for QR scan…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
