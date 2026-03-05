ALTER TABLE "FinanceDocument"
  ADD COLUMN "quoteId" TEXT,
  ADD COLUMN "invoiceIndex" INTEGER,
  ADD COLUMN "name" TEXT,
  ADD COLUMN "accountingRef" TEXT,
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3);

UPDATE "FinanceDocument"
SET "name" = COALESCE(NULLIF("reference", ''), 'Document'),
    "issuedAt" = COALESCE("dueDate", "createdAt");

ALTER TABLE "FinanceDocument"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "issuedAt" SET NOT NULL,
  ALTER COLUMN "issuedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FinanceDocument"
  ADD CONSTRAINT "FinanceDocument_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "FinanceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FinanceDocument_quoteId_idx" ON "FinanceDocument"("quoteId");
