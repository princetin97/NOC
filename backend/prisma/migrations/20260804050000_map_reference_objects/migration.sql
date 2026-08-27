-- Reference (non-device) map objects: a MapNode can now represent something other
-- than a monitored device (e.g. an "Internet" cloud, another site) for diagram context.
ALTER TABLE "MapNode" ALTER COLUMN "deviceId" DROP NOT NULL;
ALTER TABLE "MapNode" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'device';
ALTER TABLE "MapNode" ADD COLUMN "label" TEXT;
ALTER TABLE "MapNode" ADD COLUMN "icon" TEXT;

-- MapLink now connects two MapNode rows (so it can target reference objects too)
-- instead of Device rows directly. No unique constraint on the pair, so multiple
-- links between the same two objects are allowed.
ALTER TABLE "MapLink" ADD COLUMN "sourceNodeId" TEXT;
ALTER TABLE "MapLink" ADD COLUMN "targetNodeId" TEXT;

UPDATE "MapLink" l
SET "sourceNodeId" = sn.id
FROM "MapNode" sn
WHERE sn."deviceId" = l."sourceDeviceId";

UPDATE "MapLink" l
SET "targetNodeId" = tn.id
FROM "MapNode" tn
WHERE tn."deviceId" = l."targetDeviceId";

-- Drop any link that couldn't be resolved (its device had already left the map).
DELETE FROM "MapLink" WHERE "sourceNodeId" IS NULL OR "targetNodeId" IS NULL;

ALTER TABLE "MapLink" ALTER COLUMN "sourceNodeId" SET NOT NULL;
ALTER TABLE "MapLink" ALTER COLUMN "targetNodeId" SET NOT NULL;

ALTER TABLE "MapLink" DROP CONSTRAINT "MapLink_sourceDeviceId_fkey";
ALTER TABLE "MapLink" DROP CONSTRAINT "MapLink_targetDeviceId_fkey";
DROP INDEX "MapLink_sourceDeviceId_idx";
DROP INDEX "MapLink_targetDeviceId_idx";
ALTER TABLE "MapLink" DROP COLUMN "sourceDeviceId";
ALTER TABLE "MapLink" DROP COLUMN "targetDeviceId";

CREATE INDEX "MapLink_sourceNodeId_idx" ON "MapLink"("sourceNodeId");
CREATE INDEX "MapLink_targetNodeId_idx" ON "MapLink"("targetNodeId");

ALTER TABLE "MapLink" ADD CONSTRAINT "MapLink_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "MapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapLink" ADD CONSTRAINT "MapLink_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "MapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
