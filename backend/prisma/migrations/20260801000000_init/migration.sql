-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('up', 'down', 'warning', 'maintenance');

-- CreateEnum
CREATE TYPE "SnmpVersion" AS ENUM ('v1', 'v2c', 'v3');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('critical', 'major', 'minor', 'info');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('active', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('PING', 'HTTP', 'HTTPS', 'DNS', 'SSH', 'MYSQL', 'BGP', 'TCP');

-- CreateEnum
CREATE TYPE "EventFacility" AS ENUM ('syslog', 'snmp_trap', 'system', 'auth');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'server',
    "vendor" TEXT,
    "model" TEXT,
    "os" TEXT,
    "sysDescr" TEXT,
    "sysObjectId" TEXT,
    "location" TEXT,
    "rack" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'down',
    "uptimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "snmpVersion" "SnmpVersion" NOT NULL DEFAULT 'v2c',
    "snmpCommunity" TEXT,
    "snmpV3User" TEXT,
    "snmpV3AuthProto" TEXT,
    "snmpV3AuthPass" TEXT,
    "snmpV3PrivProto" TEXT,
    "snmpV3PrivPass" TEXT,
    "snmpPort" INTEGER NOT NULL DEFAULT 161,
    "cpuUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memoryUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "temperature" DOUBLE PRECISION,
    "pingLatencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "lastPolled" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Port" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ifIndex" INTEGER NOT NULL,
    "ifName" TEXT NOT NULL,
    "ifAlias" TEXT,
    "ifDescr" TEXT,
    "ifType" TEXT,
    "ifSpeed" BIGINT NOT NULL DEFAULT 0,
    "ifPhysAddress" TEXT,
    "ifAdminStatus" TEXT NOT NULL DEFAULT 'down',
    "ifOperStatus" TEXT NOT NULL DEFAULT 'down',
    "inOctets" BIGINT NOT NULL DEFAULT 0,
    "outOctets" BIGINT NOT NULL DEFAULT 0,
    "inErrors" BIGINT NOT NULL DEFAULT 0,
    "outErrors" BIGINT NOT NULL DEFAULT 0,
    "inDiscards" BIGINT NOT NULL DEFAULT 0,
    "outDiscards" BIGINT NOT NULL DEFAULT 0,
    "inRateBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outRateBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "utilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPolled" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceMetric" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "memoryUsage" DOUBLE PRECISION NOT NULL,
    "temperature" DOUBLE PRECISION,
    "pingLatencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortMetric" (
    "id" TEXT NOT NULL,
    "portId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inRateBps" DOUBLE PRECISION NOT NULL,
    "outRateBps" DOUBLE PRECISION NOT NULL,
    "inErrors" BIGINT NOT NULL,
    "outErrors" BIGINT NOT NULL,
    "utilization" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PortMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'minor',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ruleId" TEXT,
    "interfaceName" TEXT,
    "message" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'active',
    "metricValue" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "facility" "EventFacility" NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawSource" TEXT,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCheck" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "target" TEXT NOT NULL,
    "port" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'down',
    "responseTimeMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uptimePercent" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "lastCheck" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCheckHistory" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "responseTimeMs" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ServiceCheckHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Device_hostname_key" ON "Device"("hostname");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE INDEX "Port_deviceId_idx" ON "Port"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Port_deviceId_ifIndex_key" ON "Port"("deviceId", "ifIndex");

-- CreateIndex
CREATE INDEX "DeviceMetric_deviceId_timestamp_idx" ON "DeviceMetric"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "PortMetric_portId_timestamp_idx" ON "PortMetric"("portId", "timestamp");

-- CreateIndex
CREATE INDEX "Alert_deviceId_status_idx" ON "Alert"("deviceId", "status");

-- CreateIndex
CREATE INDEX "EventLog_deviceId_timestamp_idx" ON "EventLog"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "ServiceCheckHistory_serviceId_timestamp_idx" ON "ServiceCheckHistory"("serviceId", "timestamp");

-- AddForeignKey
ALTER TABLE "Port" ADD CONSTRAINT "Port_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceMetric" ADD CONSTRAINT "DeviceMetric_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortMetric" ADD CONSTRAINT "PortMetric_portId_fkey" FOREIGN KEY ("portId") REFERENCES "Port"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCheckHistory" ADD CONSTRAINT "ServiceCheckHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
