-- Rename alert severity levels: major -> high, minor -> medium, info -> low (critical unchanged).
-- RENAME VALUE preserves existing rows and column defaults automatically.
ALTER TYPE "AlertSeverity" RENAME VALUE 'major' TO 'high';
ALTER TYPE "AlertSeverity" RENAME VALUE 'minor' TO 'medium';
ALTER TYPE "AlertSeverity" RENAME VALUE 'info' TO 'low';
