-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'ESTIMATOR', 'FINANCE', 'FIELD');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "ServiceUnit" AS ENUM ('M2', 'M', 'M3', 'UNIT', 'DAY', 'HOUR', 'LUMP_SUM');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REFUSED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "MaterialSupply" AS ENUM ('CLIENT', 'COMPANY_BILLED', 'COMPANY_INCLUDED');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('TEAM', 'FOOD', 'LODGING', 'TRANSPORT', 'EQUIPMENT', 'THIRD_PARTY', 'INDIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalChannel" AS ENUM ('IN_PERSON', 'WHATSAPP', 'PHONE', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "ShareMode" AS ENUM ('DETAILED', 'SUMMARY');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "quoteSeq" INTEGER NOT NULL DEFAULT 0,
    "termsAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "tenantId" UUID NOT NULL,
    "tradeName" TEXT NOT NULL,
    "legalName" TEXT,
    "document" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "zipCode" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1F4E79',
    "logo" BYTEA,
    "logoMime" TEXT,
    "pdfFooter" TEXT,
    "defaultValidityDays" INTEGER NOT NULL DEFAULT 15,
    "defaultPaymentTerms" TEXT,
    "defaultExclusions" TEXT,
    "defaultNotes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "activeTenantId" UUID,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "PersonType" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "zipCode" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalogItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" "ServiceUnit" NOT NULL,
    "defaultPriceCents" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "siteAddress" TEXT,
    "siteCity" TEXT,
    "siteState" CHAR(2),
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE NOT NULL,
    "paymentTerms" TEXT,
    "exclusions" TEXT,
    "notes" TEXT,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountPercent" DECIMAL(5,2),
    "discountCents" BIGINT,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "contingencyPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "refusedReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "serviceId" UUID,
    "description" TEXT NOT NULL,
    "unit" "ServiceUnit" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPriceCents" BIGINT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteMaterial" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "supply" "MaterialSupply" NOT NULL,
    "itemIndex" INTEGER,
    "coefficient" DECIMAL(16,6),
    "baseQuantity" DECIMAL(14,4),
    "lossPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "packageSize" DECIMAL(14,4),
    "packageLabel" TEXT,
    "unitPriceCents" BIGINT,
    "notes" TEXT,

    CONSTRAINT "QuoteMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteCost" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "CostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" TEXT,
    "unitCostCents" BIGINT NOT NULL,
    "chargeToClient" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuoteCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteApproval" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "channel" "ApprovalChannel" NOT NULL,
    "approvedOn" DATE NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteShareLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "mode" "ShareMode" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_name_idx" ON "Customer"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_id_key" ON "Customer"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalogItem_tenantId_name_key" ON "ServiceCatalogItem"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalogItem_tenantId_id_key" ON "ServiceCatalogItem"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Quote_tenantId_status_idx" ON "Quote"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Quote_tenantId_customerId_idx" ON "Quote"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_updatedAt_idx" ON "Quote"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tenantId_number_key" ON "Quote"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tenantId_id_key" ON "Quote"("tenantId", "id");

-- CreateIndex
CREATE INDEX "QuoteItem_tenantId_quoteId_idx" ON "QuoteItem"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "QuoteMaterial_tenantId_quoteId_idx" ON "QuoteMaterial"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "QuoteCost_tenantId_quoteId_idx" ON "QuoteCost"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "QuoteVersion_tenantId_quoteId_idx" ON "QuoteVersion"("tenantId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_quoteId_revision_key" ON "QuoteVersion"("quoteId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_tenantId_id_key" ON "QuoteVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "QuoteApproval_tenantId_quoteId_idx" ON "QuoteApproval"("tenantId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteShareLink_tokenHash_key" ON "QuoteShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteShareLink_tenantId_quoteId_idx" ON "QuoteShareLink"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_tenantId_userId_key_key" ON "IdempotencyKey"("tenantId", "userId", "key");

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteMaterial" ADD CONSTRAINT "QuoteMaterial_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteCost" ADD CONSTRAINT "QuoteCost_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteApproval" ADD CONSTRAINT "QuoteApproval_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteApproval" ADD CONSTRAINT "QuoteApproval_tenantId_versionId_fkey" FOREIGN KEY ("tenantId", "versionId") REFERENCES "QuoteVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteShareLink" ADD CONSTRAINT "QuoteShareLink_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
