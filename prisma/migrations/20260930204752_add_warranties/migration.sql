-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "WarrantyStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_serviceOrderId_key" ON "Warranty"("serviceOrderId");

-- CreateIndex
CREATE INDEX "Warranty_organizationId_idx" ON "Warranty"("organizationId");

-- CreateIndex
CREATE INDEX "Warranty_organizationId_serviceOrderId_idx" ON "Warranty"("organizationId", "serviceOrderId");

-- CreateIndex
CREATE INDEX "Warranty_organizationId_status_idx" ON "Warranty"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Warranty_organizationId_endDate_idx" ON "Warranty"("organizationId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_serviceOrderId_organizationId_key" ON "Warranty"("serviceOrderId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Warranty_id_organizationId_key" ON "Warranty"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_serviceOrderId_organizationId_fkey" FOREIGN KEY ("serviceOrderId", "organizationId") REFERENCES "ServiceOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
