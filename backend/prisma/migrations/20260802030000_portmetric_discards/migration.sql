-- Add per-interval discard counters to PortMetric so alert rules can evaluate
-- interface discard deltas (matching the existing error columns).
ALTER TABLE "PortMetric" ADD COLUMN "inDiscards" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "PortMetric" ADD COLUMN "outDiscards" BIGINT NOT NULL DEFAULT 0;
