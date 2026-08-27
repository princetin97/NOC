-- Add multi-device targeting for alert rules
ALTER TABLE "AlertRule" ADD COLUMN IF NOT EXISTS "deviceIds" TEXT[] DEFAULT '{}';
