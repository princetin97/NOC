-- Alert category filter for notification channels (e.g. "temperature", "service"),
-- so one Telegram group with multiple topics can route alert types to the right topic.
ALTER TABLE "NotificationChannel" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
