const DEFAULT_RETURN_TO = '/dashboard';
const ALLOWED_PATHS = ['/dashboard', '/customers', '/equipment', '/service-orders'];
const URL_BASE = 'https://serviceflow.local';

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControlCharacter(value)) return null;

  try {
    const url = new URL(value, URL_BASE);
    if (url.origin !== URL_BASE || !isAllowedPath(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function returnToFromState(value: unknown): string {
  if (!value || typeof value !== 'object') return DEFAULT_RETURN_TO;
  const location = value as { pathname?: unknown; search?: unknown; hash?: unknown };
  const pathname = typeof location.pathname === 'string' ? location.pathname : '';
  const search = typeof location.search === 'string' ? location.search : '';
  const hash = typeof location.hash === 'string' ? location.hash : '';
  return safeReturnTo(`${pathname}${search}${hash}`) ?? DEFAULT_RETURN_TO;
}

export { DEFAULT_RETURN_TO };