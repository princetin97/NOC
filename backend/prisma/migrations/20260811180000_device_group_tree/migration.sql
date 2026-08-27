-- AlterTable
ALTER TABLE "DeviceGroup" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "DeviceGroup_parentId_idx" ON "DeviceGroup"("parentId");

-- AddForeignKey
ALTER TABLE "DeviceGroup"
ADD CONSTRAINT "DeviceGroup_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "DeviceGroup"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
