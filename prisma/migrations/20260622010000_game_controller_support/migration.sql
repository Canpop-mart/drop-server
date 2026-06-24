-- CreateEnum
CREATE TYPE "ControllerSupport" AS ENUM ('Full', 'Partial', 'None');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN "mControllerSupport" "ControllerSupport" NOT NULL DEFAULT 'None';
