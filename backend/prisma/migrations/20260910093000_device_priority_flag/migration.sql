-- Mark devices as monitoring-priority so the scheduler can poll them sooner.
ALTER TABLE "Device"
  ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Device_isPriority_idx" ON "Device"("isPriority");
