-- Add service-scoped alert rule targeting and allow alert records without a device (service alerts).
ALTER TABLE "AlertRule" ADD COLUMN "serviceId" TEXT;
ALTER TABLE "AlertRule" ADD COLUMN "serviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Alert" ADD COLUMN "serviceId" TEXT;

ALTER TABLE "Alert" ALTER COLUMN "deviceId" DROP NOT NULL;

CREATE INDEX "AlertRule_serviceId_idx" ON "AlertRule"("serviceId");
CREATE INDEX "Alert_serviceId_status_idx" ON "Alert"("serviceId", "status");
CREATE INDEX "Alert_serviceId_ruleId_status_idx" ON "Alert"("serviceId", "ruleId", "status");

ALTER TABLE "AlertRule"
  ADD CONSTRAINT "AlertRule_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "ServiceCheck"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Alert"
  ADD CONSTRAINT "Alert_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "ServiceCheck"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
