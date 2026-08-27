-- AlterTable: multi-object alert target (several same-unit sensors share one rule)
ALTER TABLE "AlertRule" ADD COLUMN "sensorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
