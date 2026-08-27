-- Performance indexes for scaling to 100+ devices

-- AlertRule: fast filter for enabled rules (queried every poll cycle)
CREATE INDEX IF NOT EXISTS "AlertRule_enabled_idx" ON "AlertRule"("enabled");

-- Alert: fast duplicate/existing check during alert evaluation
CREATE INDEX IF NOT EXISTS "Alert_deviceId_ruleId_status_idx" ON "Alert"("deviceId", "ruleId", "status");

-- DeviceMetric: fast timestamp-only cleanup deletes
CREATE INDEX IF NOT EXISTS "DeviceMetric_timestamp_idx" ON "DeviceMetric"("timestamp");

-- PortMetric: fast timestamp-only cleanup deletes
CREATE INDEX IF NOT EXISTS "PortMetric_timestamp_idx" ON "PortMetric"("timestamp");

-- ProcessorMetric: fast timestamp-only cleanup deletes
CREATE INDEX IF NOT EXISTS "ProcessorMetric_timestamp_idx" ON "ProcessorMetric"("timestamp");
