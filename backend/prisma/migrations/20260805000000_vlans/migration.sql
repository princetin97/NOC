-- CreateTable: VLANs discovered per-device via Q-BRIDGE-MIB (dot1qVlanStaticName).
CREATE TABLE "Vlan" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "vlanId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vlan_deviceId_vlanId_key" ON "Vlan"("deviceId", "vlanId");
CREATE INDEX "Vlan_deviceId_idx" ON "Vlan"("deviceId");

-- AddForeignKey
ALTER TABLE "Vlan" ADD CONSTRAINT "Vlan_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: port <-> VLAN membership (untagged = native/access VLAN).
CREATE TABLE "PortVlan" (
    "id" TEXT NOT NULL,
    "vlanId" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "untagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PortVlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortVlan_vlanId_portId_key" ON "PortVlan"("vlanId", "portId");
CREATE INDEX "PortVlan_portId_idx" ON "PortVlan"("portId");

-- AddForeignKey
ALTER TABLE "PortVlan" ADD CONSTRAINT "PortVlan_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortVlan" ADD CONSTRAINT "PortVlan_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE;
