-- AlertRule: multi-group target (rule applies to every device in any of these groups),
-- mirrors the existing deviceIds/portIds/sensorIds/serviceIds array-target pattern.
ALTER TABLE "AlertRule" ADD COLUMN "groupIds" TEXT[] NOT NULL DEFAULT '{}';
