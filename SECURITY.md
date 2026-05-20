# Security Policy

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a security issue — including vulnerabilities in the K8s provisioning logic, API authentication, encryption handling, or MCP tool implementation — please report it by email:

**support@oclnexus.com**

Include as much detail as possible:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any proof-of-concept code (if applicable)

You will receive an acknowledgement within 48 hours. We aim to assess and remediate confirmed vulnerabilities promptly and will keep you informed throughout the process.

## Scope

This policy covers the OCL Nexus Local codebase. It runs as a **local single-user tool** — there is no multi-tenancy, no external authentication server, and no cloud infrastructure in the default configuration. The primary security surface is:

- The MCP endpoint (`/api/mcp/v1`) and REST API (`/api/v1/`) — Bearer token validation
- The K8s provisioning layer — namespace isolation, NetworkPolicy enforcement
- The Configuration Vault — AES-256-GCM encryption of stored secrets
- The web shell and execute endpoints — pod-level command execution

## Supported Versions

Security fixes are applied to the latest release on `main` only.
