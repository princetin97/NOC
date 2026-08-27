-- Link each synced ESXi host to a first-class Device row so it appears in the
-- Devices list (grouped under "vCenter Device") like any SNMP-managed equipment.
ALTER TABLE "VirtualizationHost" ADD COLUMN "deviceId" TEXT;

CREATE UNIQUE INDEX "VirtualizationHost_deviceId_key" ON "VirtualizationHost"("deviceId");

ALTER TABLE "VirtualizationHost" ADD CONSTRAINT "VirtualizationHost_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
