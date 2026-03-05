ALTER TABLE "Task"
  ADD COLUMN "startsAfterTaskId" TEXT,
  ADD COLUMN "planningStartDate" TIMESTAMP(3),
  ADD COLUMN "plannedDurationDays" INTEGER,
  ADD COLUMN "planningEndDate" TIMESTAMP(3),
  ADD COLUMN "progressPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fte" DOUBLE PRECISION NOT NULL DEFAULT 1;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_startsAfterTaskId_fkey"
  FOREIGN KEY ("startsAfterTaskId") REFERENCES "Task"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Task_startsAfterTaskId_idx" ON "Task"("startsAfterTaskId");
