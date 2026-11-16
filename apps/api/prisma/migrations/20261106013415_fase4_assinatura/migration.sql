-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" BIGINT NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "maxUsers" INTEGER,
    "maxActiveProjects" INTEGER,
    "aiMonthlyRequests" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" DATE,
    "graceUntil" DATE,
    "asaasCustomerId" TEXT,
    "asaasSubscriptionId" TEXT,
    "billingType" TEXT,
    "lastPaymentAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "tenantId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_asaasSubscriptionId_key" ON "TenantSubscription"("asaasSubscriptionId");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_status_receivedAt_idx" ON "PaymentProviderEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_externalId_key" ON "PaymentProviderEvent"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
