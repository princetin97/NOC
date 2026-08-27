-- Phase 1 multi-site foundation: sites, user-site membership, and site ownership for devices/services.

CREATE TABLE "Site" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Device" ADD COLUMN "siteId" TEXT;
ALTER TABLE "ServiceCheck" ADD COLUMN "siteId" TEXT;

CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");
CREATE UNIQUE INDEX "UserSite_userId_siteId_key" ON "UserSite"("userId", "siteId");
CREATE INDEX "UserSite_siteId_idx" ON "UserSite"("siteId");
CREATE INDEX "Device_siteId_idx" ON "Device"("siteId");
CREATE INDEX "ServiceCheck_siteId_idx" ON "ServiceCheck"("siteId");

ALTER TABLE "UserSite"
  ADD CONSTRAINT "UserSite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSite"
  ADD CONSTRAINT "UserSite_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Device"
  ADD CONSTRAINT "Device_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ServiceCheck"
  ADD CONSTRAINT "ServiceCheck_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
