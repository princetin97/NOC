-- Add per-device admin note to store operational access details (e.g. access URL, account hint).
ALTER TABLE "Device"
ADD COLUMN "adminNote" TEXT;
