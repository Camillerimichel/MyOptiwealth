-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('DECIDEUR', 'N_MINUS_1', 'OPERATIONNEL');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "role" "ContactRole";

-- AlterTable
ALTER TABLE "Society" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "siren" TEXT;
