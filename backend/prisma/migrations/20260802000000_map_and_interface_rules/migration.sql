-- AlterTable: per-interface / per-device scoping for alert rules
ALTER TABLE "AlertRule" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'device';
ALTER TABLE "AlertRule" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "AlertRule" ADD COLUMN "portId" TEXT;

-- CreateTable: admin-drawn network map nodes
CREATE TABLE "MapNode" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 120,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: admin-drawn connections between devices
CREATE TABLE "MapLink" (
    "id" TEXT NOT NULL,
    "sourceDeviceId" TEXT NOT NULL,
    "sourcePortId" TEXT,
    "targetDeviceId" TEXT NOT NULL,
    "targetPortId" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MapNode_deviceId_key" ON "MapNode"("deviceId");
CREATE INDEX "AlertRule_deviceId_idx" ON "AlertRule"("deviceId");
CREATE INDEX "AlertRule_portId_idx" ON "AlertRule"("portId");
CREATE INDEX "MapLink_sourceDeviceId_idx" ON "MapLink"("sourceDeviceId");
CREATE INDEX "MapLink_targetDeviceId_idx" ON "MapLink"("targetDeviceId");

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapNode" ADD CONSTRAINT "MapNode_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapLink" ADD CONSTRAINT "MapLink_sourceDeviceId_fkey" FOREIGN KEY ("sourceDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapLink" ADD CONSTRAINT "MapLink_targetDeviceId_fkey" FOREIGN KEY ("targetDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
