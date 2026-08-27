-- DeviceGroup name must be unique within the same site, not globally.
DROP INDEX IF EXISTS "DeviceGroup_name_key";
CREATE UNIQUE INDEX "DeviceGroup_siteId_name_key" ON "DeviceGroup"("siteId", "name");
