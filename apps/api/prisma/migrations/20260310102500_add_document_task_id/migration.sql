ALTER TABLE "Document"
  ADD COLUMN "taskId" TEXT;

CREATE INDEX "Document_taskId_idx" ON "Document"("taskId");

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
