-- CreateEnum
CREATE TYPE "AiInteractionStatus" AS ENUM ('PROPOSED', 'ANSWERED', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "previousId" UUID,
    "inputText" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "status" "AiInteractionStatus" NOT NULL,
    "resultType" TEXT,
    "resultId" UUID,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "executedById" UUID,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "tenantId" UUID NOT NULL,
    "month" CHAR(7) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("tenantId","month")
);

-- CreateIndex
CREATE INDEX "AiInteraction_tenantId_userId_createdAt_idx" ON "AiInteraction"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiInteraction_tenantId_id_key" ON "AiInteraction"("tenantId", "id");
