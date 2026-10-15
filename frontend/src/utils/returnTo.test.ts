import { describe, expect, it } from 'vitest';
import { googleAuthUrl } from '../services/api';
import { DEFAULT_RETURN_TO, returnToFromState, safeReturnTo } from './returnTo';

describe('return destinations', () => {
  it('keeps a valid protected route for password login navigation', () => {
    expect(returnToFromState({ pathname: '/service-orders/123/edit', search: '?tab=quote', hash: '#items' })).toBe('/service-orders/123/edit?tab=quote#items');
  });

  it('uses the dashboard when the requested destination is invalid', () => {
    expect(returnToFromState({ pathname: 'https://evil.example' })).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('//evil.example')).toBeNull();
    expect(safeReturnTo('/login')).toBeNull();
  });

  it('passes only a valid internal destination to Google OAuth', () => {
    expect(googleAuthUrl('/customers/new')).toBe('/api/auth/google?returnTo=%2Fcustomers%2Fnew');
    expect(googleAuthUrl('https://evil.example')).toBe('/api/auth/google');
  });
});