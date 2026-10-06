-- Support multiple threshold conditions per alert rule (e.g. >70 medium, >90 high).
-- Keep legacy scalar fields on AlertRule for backward compatibility.

CREATE TABLE "AlertRuleCondition" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "condition" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "severity" "AlertSeverity" NOT NULL DEFAULT 'medium',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertRuleCondition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlertRuleCondition_ruleId_idx" ON "AlertRuleCondition"("ruleId");
CREATE INDEX "AlertRuleCondition_ruleId_order_idx" ON "AlertRuleCondition"("ruleId", "order");

ALTER TABLE "AlertRuleCondition"
  ADD CONSTRAINT "AlertRuleCondition_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one condition row from the legacy scalar fields so existing rules
-- keep exact behaviour after deployment.
INSERT INTO "AlertRuleCondition" ("id", "ruleId", "order", "condition", "threshold", "severity", "createdAt")
SELECT (r."id" || '-legacy'), r."id", 0, r."condition", r."threshold", r."severity", CURRENT_TIMESTAMP
FROM "AlertRule" r
WHERE NOT EXISTS (
  SELECT 1 FROM "AlertRuleCondition" c WHERE c."ruleId" = r."id"
);
