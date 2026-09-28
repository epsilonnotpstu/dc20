-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('unclaimed', 'active', 'suspended', 'deceased');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('super_admin', 'admin', 'moderator', 'event_manager', 'content_manager');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('members', 'only_me', 'admins');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'phone', 'email', 'url', 'tags');

-- CreateEnum
CREATE TYPE "FilterUi" AS ENUM ('dropdown', 'chips', 'search', 'range');

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "collegeRoll" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'unclaimed',
    "roles" "Role"[],
    "sscRegHash" TEXT,
    "claimCodeHash" TEXT,
    "claimCodeExpiresAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "data" JSONB NOT NULL DEFAULT '{}',
    "privacy" JSONB NOT NULL DEFAULT '{}',
    "hiddenFromDirectory" BOOLEAN NOT NULL DEFAULT false,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelBn" TEXT NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'text',
    "options" TEXT[],
    "group" TEXT NOT NULL DEFAULT 'About',
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,
    "filterUi" "FilterUi" NOT NULL DEFAULT 'dropdown',
    "isEditableByUser" BOOLEAN NOT NULL DEFAULT true,
    "defaultVisibility" "Visibility" NOT NULL DEFAULT 'members',
    "visibilityLocked" BOOLEAN NOT NULL DEFAULT false,
    "fromSeed" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimReport" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_collegeRoll_key" ON "Student"("collegeRoll");

-- CreateIndex
CREATE INDEX "Student_status_idx" ON "Student"("status");

-- CreateIndex
CREATE INDEX "Student_name_idx" ON "Student"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_key_key" ON "FieldDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_studentId_idx" ON "Session"("studentId");

-- CreateIndex
CREATE INDEX "Invite_inviteeId_idx" ON "Invite"("inviteeId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReport" ADD CONSTRAINT "ClaimReport_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
