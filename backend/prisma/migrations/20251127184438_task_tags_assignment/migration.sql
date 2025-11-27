-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Task_entityId_status_type_dueAt_idx" ON "Task"("entityId", "status", "type", "dueAt");
