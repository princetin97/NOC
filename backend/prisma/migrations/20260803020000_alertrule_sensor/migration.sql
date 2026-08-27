-- AlterTable: per-object (sensor/component) custom alert threshold target
ALTER TABLE "AlertRule" ADD COLUMN "sensorId" TEXT;

-- CreateIndex
CREATE INDEX "AlertRule_sensorId_idx" ON "AlertRule"("sensorId");

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
