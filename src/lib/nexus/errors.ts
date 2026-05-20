/**
 * OCL Nexus — Typed error hierarchy and HTTP response converter.
 *
 * Every ops/* function throws a subclass of NexusError on failure.
 * Route adapters call toResponse(err) in their catch block — zero branching,
 * one line to handle all error cases.
 *
 * Usage in route adapters:
 *   } catch (err) {
 *     return toResponse(err);
 *   }
 */
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Base error class
// ---------------------------------------------------------------------------

export class NexusError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "NexusError";
  }
}

// ---------------------------------------------------------------------------
// Concrete error types (map 1-to-1 with HTTP status codes)
// ---------------------------------------------------------------------------

/** 404 — instance or resource not found in DB */
export class NotFoundError extends NexusError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/** 403 — authenticated user does not own the resource */
export class ForbiddenError extends NexusError {
  constructor(message = "Forbidden") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

/** 400 — malformed request or precondition not met */
export class BadRequestError extends NexusError {
  constructor(message: string) {
    super(message, 400);
    this.name = "BadRequestError";
  }
}

/** 402 — user balance <= 0 and not VIP */
export class PaymentRequiredError extends NexusError {
  constructor(message = "Insufficient balance") {
    super(message, 402);
    this.name = "PaymentRequiredError";
  }
}

/** 503 — pod not found or not in Running state */
export class PodNotReadyError extends NexusError {
  constructor(message = "Pod not running") {
    super(message, 503);
    this.name = "PodNotReadyError";
  }
}

/** 429 — user has reached their max_instances ceiling */
export class InstanceLimitError extends NexusError {
  constructor(public readonly current: number, public readonly limit: number) {
    super(
      `Instance limit reached (${current}/${limit}). Terminate a workload to free a slot.`,
      429
    );
    this.name = "InstanceLimitError";
  }
}

/** 500 — internal platform error (K8s, DB, etc.) */
export class ServerError extends NexusError {
  constructor(message = "Internal error") {
    super(message, 500);
    this.name = "ServerError";
  }
}

// ---------------------------------------------------------------------------
// Response converter
// ---------------------------------------------------------------------------

/**
 * Convert any thrown value to a NextResponse with the correct HTTP status.
 *
 * NexusError subclasses map to their declared status code.
 * All other errors produce a generic 500.
 */
export function toResponse(err: unknown): NextResponse {
  // InstanceLimitError gets a structured response with numeric fields for clients
  if (err instanceof InstanceLimitError) {
    return NextResponse.json(
      { error: "instance_limit_reached", message: err.message, current: err.current, limit: err.limit },
      { status: 429 }
    );
  }
  if (err instanceof NexusError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[nexus] Unhandled error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
