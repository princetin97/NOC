-- Global per-severity re-notify defaults (used when a rule's own renotifyMinutes is 0).
CREATE TABLE "AlertRenotifySettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "critical" INTEGER NOT NULL DEFAULT 5,
    "high" INTEGER NOT NULL DEFAULT 10,
    "medium" INTEGER NOT NULL DEFAULT 30,
    "low" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AlertRenotifySettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AlertRenotifySettings" ("id") VALUES ('singleton');
