-- Alert rules can target a device group and/or multiple interfaces.
ALTER TABLE "AlertRule" ADD COLUMN "groupId" TEXT;
ALTER TABLE "AlertRule" ADD COLUMN "portIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "AlertRule_groupId_idx" ON "AlertRule"("groupId");

ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "DeviceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
