-- AlterTable: dynamic fleet alert target — match all sensors of a type, filtered by OS
ALTER TABLE "AlertRule" ADD COLUMN "sensorType" TEXT;
ALTER TABLE "AlertRule" ADD COLUMN "osFilter" TEXT;
