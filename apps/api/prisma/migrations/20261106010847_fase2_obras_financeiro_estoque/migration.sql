-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "MeasurementStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PHOTO', 'RECEIPT', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MATERIAL', 'TEAM', 'FOOD', 'LODGING', 'TRANSPORT', 'EQUIPMENT', 'THIRD_PARTY', 'INDIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PLANNED', 'COMMITTED', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'TRANSFER', 'CARD', 'BOLETO', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceivableKind" AS ENUM ('DOWN_PAYMENT', 'INSTALLMENT', 'MEASUREMENT', 'MILESTONE', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'TRANSFER', 'LOSS', 'RETURN', 'ADJUST_IN', 'ADJUST_OUT');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "projectSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "quoteId" UUID,
    "quoteRevision" INTEGER,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "siteAddress" TEXT,
    "siteCity" TEXT,
    "siteState" CHAR(2),
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" DATE,
    "expectedEndDate" DATE,
    "completedAt" TIMESTAMP(3),
    "contractTotalCents" BIGINT NOT NULL,
    "plannedCostCents" BIGINT NOT NULL DEFAULT 0,
    "plannedTaxCents" BIGINT NOT NULL DEFAULT 0,
    "plannedContingencyCents" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "ServiceUnit" NOT NULL,
    "plannedQuantity" DECIMAL(14,4) NOT NULL,
    "unitPriceCents" BIGINT NOT NULL DEFAULT 0,
    "measuredQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" "StageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "measuredOn" DATE NOT NULL,
    "notes" TEXT,
    "status" "MeasurementStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "createdById" UUID,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "measurementId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "valueCents" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "MeasurementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiaryEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "weather" TEXT,
    "workersCount" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'PHOTO',
    "projectId" UUID,
    "stageId" UUID,
    "measurementId" UUID,
    "diaryEntryId" UUID,
    "expenseId" UUID,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "takenAt" TIMESTAMP(3),
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID,
    "groupId" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4),
    "unit" TEXT,
    "amountCents" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'COMMITTED',
    "paidOn" DATE,
    "paymentMethod" "PaymentMethod",
    "supplier" TEXT,
    "worker" TEXT,
    "notes" TEXT,
    "cancelReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receivable" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID,
    "customerId" UUID NOT NULL,
    "measurementId" UUID,
    "kind" "ReceivableKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "dueDate" DATE NOT NULL,
    "cancelReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivablePayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" UUID,
    "reverseReason" TEXT,

    CONSTRAINT "ReceivablePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "packageLabel" TEXT,
    "packageSize" DECIMAL(14,4),
    "minStock" DECIMAL(14,4),
    "lastCostCents" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "fromLocationId" UUID,
    "toLocationId" UUID,
    "projectId" UUID,
    "expenseId" UUID,
    "unitCostCents" BIGINT,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMaterial" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "materialId" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(14,4) NOT NULL,
    "supply" "MaterialSupply" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_tenantId_status_idx" ON "Project"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_number_key" ON "Project"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_id_key" ON "Project"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_quoteId_key" ON "Project"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "ProjectStage_tenantId_projectId_idx" ON "ProjectStage"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStage_tenantId_id_key" ON "ProjectStage"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Measurement_tenantId_projectId_idx" ON "Measurement"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Measurement_projectId_number_key" ON "Measurement"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Measurement_tenantId_id_key" ON "Measurement"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementItem_measurementId_stageId_key" ON "MeasurementItem"("measurementId", "stageId");

-- CreateIndex
CREATE INDEX "DiaryEntry_tenantId_projectId_date_idx" ON "DiaryEntry"("tenantId", "projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DiaryEntry_tenantId_id_key" ON "DiaryEntry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_tenantId_projectId_idx" ON "Attachment"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "Expense_tenantId_projectId_idx" ON "Expense"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "Expense_tenantId_status_dueDate_idx" ON "Expense"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Expense_tenantId_date_idx" ON "Expense"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_id_key" ON "Expense"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_measurementId_key" ON "Receivable"("measurementId");

-- CreateIndex
CREATE INDEX "Receivable_tenantId_projectId_idx" ON "Receivable"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "Receivable_tenantId_dueDate_idx" ON "Receivable"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_tenantId_id_key" ON "Receivable"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_tenantId_measurementId_key" ON "Receivable"("tenantId", "measurementId");

-- CreateIndex
CREATE INDEX "ReceivablePayment_tenantId_receivableId_idx" ON "ReceivablePayment"("tenantId", "receivableId");

-- CreateIndex
CREATE INDEX "ReceivablePayment_tenantId_paidOn_idx" ON "ReceivablePayment"("tenantId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "Material_tenantId_name_key" ON "Material"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Material_tenantId_id_key" ON "Material"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_projectId_key" ON "StockLocation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_tenantId_name_key" ON "StockLocation"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_tenantId_id_key" ON "StockLocation"("tenantId", "id");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_materialId_idx" ON "StockMovement"("tenantId", "materialId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_projectId_idx" ON "StockMovement"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_tenantId_projectId_idx" ON "ProjectMaterial"("tenantId", "projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementItem" ADD CONSTRAINT "MeasurementItem_tenantId_measurementId_fkey" FOREIGN KEY ("tenantId", "measurementId") REFERENCES "Measurement"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementItem" ADD CONSTRAINT "MeasurementItem_tenantId_stageId_fkey" FOREIGN KEY ("tenantId", "stageId") REFERENCES "ProjectStage"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_stageId_fkey" FOREIGN KEY ("tenantId", "stageId") REFERENCES "ProjectStage"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_measurementId_fkey" FOREIGN KEY ("tenantId", "measurementId") REFERENCES "Measurement"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_diaryEntryId_fkey" FOREIGN KEY ("tenantId", "diaryEntryId") REFERENCES "DiaryEntry"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_expenseId_fkey" FOREIGN KEY ("tenantId", "expenseId") REFERENCES "Expense"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_tenantId_measurementId_fkey" FOREIGN KEY ("tenantId", "measurementId") REFERENCES "Measurement"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivablePayment" ADD CONSTRAINT "ReceivablePayment_tenantId_receivableId_fkey" FOREIGN KEY ("tenantId", "receivableId") REFERENCES "Receivable"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_materialId_fkey" FOREIGN KEY ("tenantId", "materialId") REFERENCES "Material"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fromLocationId_fkey" FOREIGN KEY ("tenantId", "fromLocationId") REFERENCES "StockLocation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_toLocationId_fkey" FOREIGN KEY ("tenantId", "toLocationId") REFERENCES "StockLocation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_expenseId_fkey" FOREIGN KEY ("tenantId", "expenseId") REFERENCES "Expense"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_tenantId_materialId_fkey" FOREIGN KEY ("tenantId", "materialId") REFERENCES "Material"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
