ALTER TABLE "Task"
ADD COLUMN "orderNumber" INTEGER NOT NULL DEFAULT 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId", "status"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Task"
)
UPDATE "Task" t
SET "orderNumber" = ranked.rn
FROM ranked
WHERE t.id = ranked.id;

CREATE INDEX "Task_workspaceId_status_orderNumber_idx"
ON "Task"("workspaceId", "status", "orderNumber");
