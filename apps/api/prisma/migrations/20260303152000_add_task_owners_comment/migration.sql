ALTER TABLE "Task"
ADD COLUMN "privateComment" TEXT,
ADD COLUMN "companyOwnerContactId" TEXT;

CREATE INDEX "Task_companyOwnerContactId_idx"
ON "Task"("companyOwnerContactId");

ALTER TABLE "Task"
ADD CONSTRAINT "Task_companyOwnerContactId_fkey"
FOREIGN KEY ("companyOwnerContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
