-- AlterTable: richer device identity (firmware/version + serial number)
ALTER TABLE "Device" ADD COLUMN "firmware" TEXT;
ALTER TABLE "Device" ADD COLUMN "serial" TEXT;

-- CreateTable: discovered per-device health sensors (LibreNMS-style)
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "index" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "lastPolled" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sensor_deviceId_type_index_key" ON "Sensor"("deviceId", "type", "index");
CREATE INDEX "Sensor_deviceId_idx" ON "Sensor"("deviceId");

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
