import { describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaServiceOrderRepository, ServiceOrderInUseError, isForeignKeyRestriction } from '../src/modules/service-orders/repository.js';

const restrictMessage = 'Error occurred during query execution: ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23001", message: "update or delete on table \\"ServiceOrder\\" violates RESTRICT setting of foreign key constraint \\"ServiceOrderStatusHistory_serviceOrderId_organizationId_fkey\\" on table \\"ServiceOrderStatusHistory\\"" }) })';

function repositoryThatFailsWith(error: unknown) {
  const db = { serviceOrder: { deleteMany: async () => { throw error; } } } as unknown as PrismaClient;
  return new PrismaServiceOrderRepository(db);
}

describe('PrismaServiceOrderRepository.delete', () => {
  it('maps a PostgreSQL RESTRICT violation (23001) to ServiceOrderInUseError', async () => {
    const error = new Prisma.PrismaClientUnknownRequestError(restrictMessage, { clientVersion: 'test' });
    await expect(repositoryThatFailsWith(error).delete('organization-1', 'order-1')).rejects.toBeInstanceOf(ServiceOrderInUseError);
  });

  it('keeps mapping Prisma P2003 to ServiceOrderInUseError', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: 'test' });
    await expect(repositoryThatFailsWith(error).delete('organization-1', 'order-1')).rejects.toBeInstanceOf(ServiceOrderInUseError);
  });

  it('rethrows unrelated database errors', async () => {
    const error = new Prisma.PrismaClientUnknownRequestError('connection reset', { clientVersion: 'test' });
    expect(isForeignKeyRestriction(error)).toBe(false);
    await expect(repositoryThatFailsWith(error).delete('organization-1', 'order-1')).rejects.toBe(error);
  });
});
