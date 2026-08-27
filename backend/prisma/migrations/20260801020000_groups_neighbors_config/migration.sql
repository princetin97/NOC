-- CreateEnum
CREATE TYPE "NeighborProtocol" AS ENUM ('lldp', 'cdp');

-- AlterTable: SSH access + group relation on Device
ALTER TABLE "Device" ADD COLUMN "sshPort" INTEGER NOT NULL DEFAULT 22;
ALTER TABLE "Device" ADD COLUMN "sshUsername" TEXT;
ALTER TABLE "Device" ADD COLUMN "sshPassword" TEXT;
ALTER TABLE "Device" ADD COLUMN "sshEnablePassword" TEXT;
ALTER TABLE "Device" ADD COLUMN "groupId" TEXT;

-- CreateTable
CREATE TABLE "DeviceGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceNeighbor" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "protocol" "NeighborProtocol" NOT NULL,
    "localPortName" TEXT NOT NULL,
    "remoteSysName" TEXT,
    "remoteChassisId" TEXT,
    "remotePortId" TEXT,
    "remotePortDescr" TEXT,
    "remoteMgmtAddr" TEXT,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceNeighbor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigBackup" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "retrievedVia" TEXT NOT NULL DEFAULT 'ssh',
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceGroup_name_key" ON "DeviceGroup"("name");

-- CreateIndex
CREATE INDEX "Device_groupId_idx" ON "Device"("groupId");

-- CreateIndex
CREATE INDEX "DeviceNeighbor_deviceId_idx" ON "DeviceNeighbor"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceNeighbor_deviceId_localPortName_remoteChassisId_remotePortId_key" ON "DeviceNeighbor"("deviceId", "localPortName", "remoteChassisId", "remotePortId");

-- CreateIndex
CREATE INDEX "ConfigBackup_deviceId_createdAt_idx" ON "ConfigBackup"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DeviceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceNeighbor" ADD CONSTRAINT "DeviceNeighbor_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigBackup" ADD CONSTRAINT "ConfigBackup_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
