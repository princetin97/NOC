-- Per-rule re-notify interval + per-alert last-notified timestamp for repeat notifications.
ALTER TABLE "AlertRule" ADD COLUMN "renotifyMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Alert" ADD COLUMN "lastNotifiedAt" TIMESTAMP(3);
