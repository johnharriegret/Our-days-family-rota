-- Security hardening for Supabase-hosted Postgres.
--
-- This application uses Prisma over a server-side Postgres connection and its
-- own cookie/session authorization. It does not use Supabase's browser Data API.
-- Public-schema tables therefore must not be exposed to Supabase API roles.
--
-- RLS is enabled on every application table to satisfy Supabase's security
-- requirement. The Prisma/server database owner continues to use the direct
-- server-side connection; we intentionally create NO anon/authenticated RLS
-- policies.

ALTER TABLE "Household" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FamilyMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftPattern" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnualLeaveGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChildcareRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FamilySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "APIKey" ENABLE ROW LEVEL SECURITY;

-- Prisma creates this table in public. Keep migration metadata out of the
-- Supabase Data API as well. IF EXISTS keeps this migration portable.
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Defense in depth: these roles are used by Supabase's public Data API.
-- The app does not need either role because all DB access is server-side.
REVOKE ALL PRIVILEGES ON TABLE
  "Household",
  "User",
  "FamilyMember",
  "ShiftPattern",
  "ShiftBlock",
  "ShiftType",
  "WorkShift",
  "School",
  "SchoolTerm",
  "Event",
  "AnnualLeaveGrant",
  "ChildcareRule",
  "FamilySettings",
  "APIKey"
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM anon, authenticated;
