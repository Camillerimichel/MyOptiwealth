-- Add user activation flag to allow manual deactivation from workspace settings.
ALTER TABLE "User"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
