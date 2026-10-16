import { describe, expect, it } from 'vitest';
import { hasPermission, orderStatusPermission, quoteStatusPermission } from './permissions';

describe('hasPermission', () => {
  it('uses only the permissions computed by the server', () => {
    const technician = { permissions: ['customers:read', 'customers:write'] };
    expect(hasPermission(technician, 'customers:write')).toBe(true);
    expect(hasPermission(technician, 'customers:delete')).toBe(false);
    expect(hasPermission(technician, 'payments:read')).toBe(false);
  });

  it('denies when there is no user or no permission list (never assumes a role)', () => {
    expect(hasPermission(null, 'customers:read')).toBe(false);
    expect(hasPermission(undefined, 'customers:read')).toBe(false);
    expect(hasPermission({}, 'customers:read')).toBe(false);
    expect(hasPermission({ permissions: [] }, 'customers:read')).toBe(false);
  });

  it('does not treat the role name as a permission', () => {
    expect(hasPermission({ role: 'OWNER', permissions: [] } as never, 'payments:read')).toBe(false);
  });
});

describe('status permissions', () => {
  it('requires dedicated permissions to approve or cancel an order, and none for the other transitions', () => {
    expect(orderStatusPermission('APPROVED')).toBe('serviceOrders:approve');
    expect(orderStatusPermission('CANCELLED')).toBe('serviceOrders:cancel');
    for (const status of ['RECEIVED', 'WAITING_DIAGNOSIS', 'WAITING_APPROVAL', 'IN_PROGRESS', 'READY', 'DELIVERED']) expect(orderStatusPermission(status)).toBeNull();
  });

  it('requires a decision permission for every quote status, never letting one through', () => {
    expect(quoteStatusPermission('APPROVED')).toBe('quotes:approve');
    expect(quoteStatusPermission('REJECTED')).toBe('quotes:reject');
    expect(quoteStatusPermission('EXPIRED')).toBe('quotes:expire');
    expect(quoteStatusPermission('PENDING')).toBe('quotes:expire');
  });
});
