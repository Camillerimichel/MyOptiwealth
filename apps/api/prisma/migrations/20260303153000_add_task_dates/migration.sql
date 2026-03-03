-- Add task planning/execution dates
ALTER TABLE "Task"
ADD COLUMN "startDate" TIMESTAMP(3),
ADD COLUMN "expectedEndDate" TIMESTAMP(3),
ADD COLUMN "actualEndDate" TIMESTAMP(3);
