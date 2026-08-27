ALTER TABLE "VirtualizationHost" ADD COLUMN "cpuUsage" DOUBLE PRECISION;
ALTER TABLE "VirtualizationHost" ADD COLUMN "memoryUsage" DOUBLE PRECISION;
ALTER TABLE "VirtualizationHost" ADD COLUMN "inventorySummary" TEXT;
ALTER TABLE "VirtualizationHost" ADD COLUMN "alertState" TEXT NOT NULL DEFAULT 'ok';
