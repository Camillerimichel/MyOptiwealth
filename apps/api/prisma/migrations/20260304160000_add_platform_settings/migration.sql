CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "singletonKey" TEXT NOT NULL DEFAULT 'GLOBAL',
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapUser" TEXT,
    "imapPasswordEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformSettings_singletonKey_key" ON "PlatformSettings"("singletonKey");
