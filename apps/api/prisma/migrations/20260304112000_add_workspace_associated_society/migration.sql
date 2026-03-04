-- AlterTable
ALTER TABLE "WorkspaceSettings"
ADD COLUMN "associatedSocietyId" TEXT;

-- CreateIndex
CREATE INDEX "WorkspaceSettings_associatedSocietyId_idx" ON "WorkspaceSettings"("associatedSocietyId");
