# ═══════════════════════════════════════════════════════════════════════════
# OCL Nexus Local — Production Dockerfile
# ═══════════════════════════════════════════════════════════════════════════

FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Production stage ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

COPY . .

# Build Next.js application
# Note: Provide dummy env vars for build-time route analysis (not actually used)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXUS_MODE=local
ENV NEXT_PUBLIC_NEXUS_MODE=local
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon-key
ENV SUPABASE_SERVICE_ROLE_KEY=dummy-service-role-key
ENV SUPABASE_ANON_KEY=dummy-anon-key
ENV ENCRYPTION_KEY=nexus-local-dev-key-change-me!!!
RUN npm run build

# Add non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["npm", "start"]
