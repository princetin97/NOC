-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('email', 'telegram', 'webhook', 'slack');

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minSeverity" "AlertSeverity" NOT NULL DEFAULT 'minor',
    "config" TEXT NOT NULL,
    "lastError" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);
