CREATE TABLE "VirtualizationManager" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "siteId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VirtualizationManager_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VirtualizationHost" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "powerState" TEXT,
    "connectionState" TEXT,
    "cpuMhz" INTEGER,
    "cpuCores" INTEGER,
    "memoryBytes" DOUBLE PRECISION,
    "vmCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VirtualizationHost_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VirtualMachine" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "hostId" TEXT,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "powerState" TEXT,
    "cpuCount" INTEGER,
    "memoryBytes" DOUBLE PRECISION,
    "guestOs" TEXT,
    "ipAddress" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VirtualizationManager_endpoint_key" ON "VirtualizationManager"("endpoint");
CREATE INDEX "VirtualizationManager_siteId_idx" ON "VirtualizationManager"("siteId");
CREATE UNIQUE INDEX "VirtualizationHost_managerId_externalId_key" ON "VirtualizationHost"("managerId", "externalId");
CREATE INDEX "VirtualizationHost_managerId_idx" ON "VirtualizationHost"("managerId");
CREATE UNIQUE INDEX "VirtualMachine_managerId_externalId_key" ON "VirtualMachine"("managerId", "externalId");
CREATE INDEX "VirtualMachine_managerId_idx" ON "VirtualMachine"("managerId");
CREATE INDEX "VirtualMachine_hostId_idx" ON "VirtualMachine"("hostId");
ALTER TABLE "VirtualizationManager" ADD CONSTRAINT "VirtualizationManager_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VirtualizationHost" ADD CONSTRAINT "VirtualizationHost_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "VirtualizationManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "VirtualizationManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "VirtualizationHost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
