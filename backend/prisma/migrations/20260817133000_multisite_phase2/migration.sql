-- Phase 2 multi-site scope: alert-rules, notification channels, dashboards, and topology map nodes.

ALTER TABLE "AlertRule" ADD COLUMN "siteId" TEXT;
ALTER TABLE "NotificationChannel" ADD COLUMN "siteId" TEXT;
ALTER TABLE "Dashboard" ADD COLUMN "siteId" TEXT;
ALTER TABLE "MapNode" ADD COLUMN "siteId" TEXT;

CREATE INDEX "AlertRule_siteId_idx" ON "AlertRule"("siteId");
CREATE INDEX "NotificationChannel_siteId_idx" ON "NotificationChannel"("siteId");
CREATE INDEX "Dashboard_siteId_idx" ON "Dashboard"("siteId");
CREATE INDEX "MapNode_siteId_idx" ON "MapNode"("siteId");

ALTER TABLE "AlertRule"
  ADD CONSTRAINT "AlertRule_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Dashboard"
  ADD CONSTRAINT "Dashboard_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MapNode"
  ADD CONSTRAINT "MapNode_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill map-node site from mapped device when possible.
UPDATE "MapNode" mn
SET "siteId" = d."siteId"
FROM "Device" d
WHERE mn."deviceId" = d."id";
