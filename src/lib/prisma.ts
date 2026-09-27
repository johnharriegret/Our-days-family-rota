import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Supabase's runtime connection (POSTGRES_URL) is pooled through PgBouncer in
 * transaction mode: each query can be routed to a different backend Postgres
 * connection than the one before it. Prisma defaults to naming and caching
 * server-side prepared statements per connection, so a name that one pooled
 * connection cached can collide with a same-named statement already prepared
 * by a completely different client on the backend connection PgBouncer hands
 * back next - Postgres then rejects it with 42P05 "prepared statement already
 * exists". This surfaced in production as almost every API route failing.
 *
 * Appending `pgbouncer=true` tells Prisma's Postgres driver to stop using named
 * prepared statements (describe/execute per query instead), which is exactly
 * what PgBouncer's transaction mode requires and is Prisma's own documented
 * fix. It's harmless against a non-pooled connection too (slightly less
 * statement-cache reuse, no correctness difference), so it's safe to always
 * apply rather than branch on environment. `POSTGRES_PRISMA_URL`, when the
 * Vercel/Supabase integration provisions it, already has this and other
 * Prisma-specific tuning baked in, so it's preferred when present.
 */
function poolerSafeUrl(): string {
  const base = process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;
  if (!base) throw new Error("POSTGRES_URL (or POSTGRES_PRISMA_URL) is not set");
  if (/[?&]pgbouncer=/.test(base)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}pgbouncer=true`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: poolerSafeUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
