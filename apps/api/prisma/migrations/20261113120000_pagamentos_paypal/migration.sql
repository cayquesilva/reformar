-- AlterTable
ALTER TABLE "TenantSubscription" ADD COLUMN     "paypalSubscriptionId" TEXT,
ADD COLUMN     "provider" TEXT;

-- CreateTable
CREATE TABLE "PaymentProviderConfig" (
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "secrets" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderConfig_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "PaymentProviderPlan" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "planId" UUID NOT NULL,
    "priceCents" BIGINT NOT NULL,
    "cycle" TEXT NOT NULL,
    "externalPlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderPlan_provider_environment_planId_priceCents__key" ON "PaymentProviderPlan"("provider", "environment", "planId", "priceCents", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_paypalSubscriptionId_key" ON "TenantSubscription"("paypalSubscriptionId");


-- Assinaturas anteriores eram todas do Asaas.
UPDATE "TenantSubscription" SET "provider" = 'ASAAS' WHERE "asaasSubscriptionId" IS NOT NULL;
