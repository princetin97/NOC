-- AlterTable: hardware/OS inventory fields (CPU core count, total RAM bytes, OS version/distro)
ALTER TABLE "Device" ADD COLUMN "osVersion" TEXT;
ALTER TABLE "Device" ADD COLUMN "cpuCount" INTEGER;
ALTER TABLE "Device" ADD COLUMN "totalMemoryBytes" DOUBLE PRECISION;
