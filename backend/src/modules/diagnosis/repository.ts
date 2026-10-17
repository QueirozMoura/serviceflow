import { Prisma, type Diagnosis, type PrismaClient } from '@prisma/client';
import { lockEditableServiceOrder } from '../shared/due-value.js';
import type { CreateDiagnosisInput, UpdateDiagnosisInput } from './schemas.js';

export type DiagnosisRecord = Pick<Diagnosis, 'id' | 'serviceOrderId' | 'description' | 'estimatedCost' | 'createdAt' | 'updatedAt'> & {
  serviceOrder: { id: string; orderNumber: string; status: string };
};

export interface DiagnosisRepository {
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean>;
  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<DiagnosisRecord | null>;
  create(organizationId: string, serviceOrderId: string, input: CreateDiagnosisInput): Promise<DiagnosisRecord>;
  update(organizationId: string, serviceOrderId: string, input: UpdateDiagnosisInput): Promise<DiagnosisRecord | null>;
  delete(organizationId: string, serviceOrderId: string): Promise<boolean>;
}

const diagnosisInclude = {
  serviceOrder: { select: { id: true, orderNumber: true, status: true } },
} as const;

export class PrismaDiagnosisRepository implements DiagnosisRepository {
  constructor(private readonly db: PrismaClient) {}

  async serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean> {
    const serviceOrder = await this.db.serviceOrder.findFirst({ where: { id: serviceOrderId, organizationId }, select: { id: true } });
    return serviceOrder !== null;
  }

  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<DiagnosisRecord | null> {
    return this.db.diagnosis.findFirst({ where: { serviceOrder: { id: serviceOrderId, organizationId } }, include: diagnosisInclude });
  }

  async create(organizationId: string, serviceOrderId: string, input: CreateDiagnosisInput): Promise<DiagnosisRecord> {
    try {
      return await this.db.$transaction(async (transaction) => {
        if ((await lockEditableServiceOrder(transaction, organizationId, serviceOrderId)) === null) throw new DiagnosisServiceOrderNotFoundError();
        return transaction.diagnosis.create({ data: { serviceOrderId, ...input }, include: diagnosisInclude });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DiagnosisAlreadyExistsError();
      throw error;
    }
  }

  async update(organizationId: string, serviceOrderId: string, input: UpdateDiagnosisInput): Promise<DiagnosisRecord | null> {
    return this.db.$transaction(async (transaction) => {
      if ((await lockEditableServiceOrder(transaction, organizationId, serviceOrderId)) === null) return null;
      const diagnosis = await transaction.diagnosis.findFirst({ where: { serviceOrderId } });
      if (!diagnosis) return null;
      return transaction.diagnosis.update({ where: { id: diagnosis.id }, data: input, include: diagnosisInclude });
    });
  }

  async delete(organizationId: string, serviceOrderId: string): Promise<boolean> {
    try {
      return await this.db.$transaction(async (transaction) => {
        if ((await lockEditableServiceOrder(transaction, organizationId, serviceOrderId)) === null) return false;
        const diagnosis = await transaction.diagnosis.findFirst({ where: { serviceOrderId } });
        if (!diagnosis) return false;
        await transaction.diagnosis.delete({ where: { id: diagnosis.id } });
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new DiagnosisInUseError();
      throw error;
    }
  }
}

export class DiagnosisServiceOrderNotFoundError extends Error {}

export class DiagnosisAlreadyExistsError extends Error {
  constructor() {
    super('Diagnosis already exists for this service order');
    this.name = 'DiagnosisAlreadyExistsError';
  }
}

export class DiagnosisInUseError extends Error {
  constructor() {
    super('Diagnosis cannot be deleted while it has related records');
    this.name = 'DiagnosisInUseError';
  }
}