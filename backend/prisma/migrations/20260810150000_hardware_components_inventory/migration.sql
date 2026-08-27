-- Hardware inventory of physical components (ENTITY-MIB) per device.
CREATE TABLE "HardwareComponent" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "entityIndex" INTEGER NOT NULL,
  "parentEntityIndex" INTEGER,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "class" TEXT NOT NULL,
  "model" TEXT,
  "serial" TEXT,
  "hardwareRev" TEXT,
  "softwareRev" TEXT,
  "isFru" BOOLEAN NOT NULL DEFAULT false,
  "operStatus" TEXT,
  "adminStatus" TEXT,
  "alarmStatus" TEXT,
  "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HardwareComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HardwareComponent_deviceId_entityIndex_key"
ON "HardwareComponent"("deviceId", "entityIndex");

CREATE INDEX "HardwareComponent_deviceId_idx"
ON "HardwareComponent"("deviceId");

CREATE INDEX "HardwareComponent_deviceId_healthStatus_idx"
ON "HardwareComponent"("deviceId", "healthStatus");

ALTER TABLE "HardwareComponent"
ADD CONSTRAINT "HardwareComponent_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
