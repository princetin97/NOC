-- Speeds up the per-device alert history tab (GET /devices/:id/alerts, last 30 days).
CREATE INDEX "Alert_deviceId_timestamp_idx" ON "Alert"("deviceId", "timestamp");
