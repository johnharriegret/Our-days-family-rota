-- AlterTable
ALTER TABLE "ChildcareRule" ADD COLUMN     "pickupBufferMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "strictPickupAge" INTEGER;
