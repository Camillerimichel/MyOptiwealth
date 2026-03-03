-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "signatureRequestId" TEXT;

-- CreateIndex
CREATE INDEX "Document_signatureRequestId_idx" ON "Document"("signatureRequestId");
