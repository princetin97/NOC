-- CreateTable: per-sensor time-series (drives history graphs, e.g. UPS load % over time)
CREATE TABLE "SensorMetric" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SensorMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SensorMetric_sensorId_timestamp_idx" ON "SensorMetric"("sensorId", "timestamp");
CREATE INDEX "SensorMetric_timestamp_idx" ON "SensorMetric"("timestamp");

-- AddForeignKey
ALTER TABLE "SensorMetric" ADD CONSTRAINT "SensorMetric_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
