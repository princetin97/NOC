-- CreateTable: per-processor inventory (LibreNMS-style, many processors per device)
CREATE TABLE "Processor" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "index" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "usage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPolled" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Processor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Processor_deviceId_index_key" ON "Processor"("deviceId", "index");
CREATE INDEX "Processor_deviceId_idx" ON "Processor"("deviceId");

-- AddForeignKey
ALTER TABLE "Processor" ADD CONSTRAINT "Processor_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: per-processor utilisation time-series
CREATE TABLE "ProcessorMetric" (
    "id" TEXT NOT NULL,
    "processorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProcessorMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessorMetric_processorId_timestamp_idx" ON "ProcessorMetric"("processorId", "timestamp");

-- AddForeignKey
ALTER TABLE "ProcessorMetric" ADD CONSTRAINT "ProcessorMetric_processorId_fkey" FOREIGN KEY ("processorId") REFERENCES "Processor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
