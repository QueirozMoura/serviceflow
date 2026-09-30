-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('RECEIVED', 'WAITING_DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ServiceItemType" AS ENUM ('LABOR', 'PART');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "document" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "ServiceOrderStatus" NOT NULL,
    "problemDescription" TEXT NOT NULL,
    "technicianNotes" TEXT,
    "estimatedValue" DECIMAL(12,2),
    "finalValue" DECIMAL(12,2),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedCost" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "type" "ServiceItemType" NOT NULL,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrderStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "fromStatus" "ServiceOrderStatus",
    "toStatus" "ServiceOrderStatus" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_organizationId_key" ON "User"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");

-- CreateIndex
CREATE INDEX "Customer_organizationId_phone_idx" ON "Customer"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "Customer_organizationId_name_idx" ON "Customer"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Customer_organizationId_email_idx" ON "Customer"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Equipment_organizationId_idx" ON "Equipment"("organizationId");

-- CreateIndex
CREATE INDEX "Equipment_organizationId_customerId_idx" ON "Equipment"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Equipment_organizationId_serialNumber_idx" ON "Equipment"("organizationId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_id_organizationId_key" ON "Equipment"("id", "organizationId");

-- CreateIndex
CREATE INDEX "ServiceOrder_organizationId_idx" ON "ServiceOrder"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceOrder_organizationId_status_idx" ON "ServiceOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ServiceOrder_organizationId_customerId_idx" ON "ServiceOrder"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "ServiceOrder_organizationId_equipmentId_idx" ON "ServiceOrder"("organizationId", "equipmentId");

-- CreateIndex
CREATE INDEX "ServiceOrder_organizationId_receivedAt_idx" ON "ServiceOrder"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_organizationId_orderNumber_key" ON "ServiceOrder"("organizationId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_id_organizationId_key" ON "ServiceOrder"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Diagnosis_serviceOrderId_key" ON "Diagnosis"("serviceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_serviceOrderId_key" ON "Quote"("serviceOrderId");

-- CreateIndex
CREATE INDEX "ServiceItem_quoteId_idx" ON "ServiceItem"("quoteId");

-- CreateIndex
CREATE INDEX "ServiceOrderStatusHistory_organizationId_idx" ON "ServiceOrderStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceOrderStatusHistory_serviceOrderId_createdAt_idx" ON "ServiceOrderStatusHistory"("serviceOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceOrderStatusHistory_changedByUserId_idx" ON "ServiceOrderStatusHistory"("changedByUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_equipmentId_organizationId_fkey" FOREIGN KEY ("equipmentId", "organizationId") REFERENCES "Equipment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrderStatusHistory" ADD CONSTRAINT "ServiceOrderStatusHistory_serviceOrderId_organizationId_fkey" FOREIGN KEY ("serviceOrderId", "organizationId") REFERENCES "ServiceOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrderStatusHistory" ADD CONSTRAINT "ServiceOrderStatusHistory_changedByUserId_organizationId_fkey" FOREIGN KEY ("changedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

