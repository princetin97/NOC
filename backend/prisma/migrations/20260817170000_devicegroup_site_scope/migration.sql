-- Add site ownership for device groups to support site-scoped group views and moves.
ALTER TABLE "DeviceGroup" ADD COLUMN "siteId" TEXT;

CREATE INDEX "DeviceGroup_siteId_idx" ON "DeviceGroup"("siteId");

ALTER TABLE "DeviceGroup"
  ADD CONSTRAINT "DeviceGroup_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill group site from member devices when all devices in a group share one site.
WITH single_site_group AS (
  SELECT d."groupId" AS group_id, MIN(d."siteId") AS site_id
  FROM "Device" d
  WHERE d."groupId" IS NOT NULL
  GROUP BY d."groupId"
  HAVING COUNT(DISTINCT d."siteId") = 1
)
UPDATE "DeviceGroup" g
SET "siteId" = s.site_id
FROM single_site_group s
WHERE g."id" = s.group_id
  AND g."siteId" IS NULL;
