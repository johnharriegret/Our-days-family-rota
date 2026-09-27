-- AlterTable
ALTER TABLE "SchoolTerm" ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];
