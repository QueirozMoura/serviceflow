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

export function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControlCharacter(value)) return undefined;

  try {
    const url = new URL(value, URL_BASE);
    if (url.origin !== URL_BASE || !isAllowedPath(url.pathname)) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}