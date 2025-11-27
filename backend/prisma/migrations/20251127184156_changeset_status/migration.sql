-- AlterTable
ALTER TABLE "ChangeSet" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';
