/** Símbolo do ServiceFlow: um fluxo contínuo em "S" que termina em um ponto de entrega. Decorativo; o nome vem do texto ao lado. */
export function BrandMark({ size = 34 }: { size?: number }) {
  return <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="8" className="brand-mark-bg" />
    <path className="brand-mark-flow" d="M22.5 7H12.5a4.75 4.75 0 0 0 0 9.5h7a4.75 4.75 0 0 1 0 9.5H9.5" />
    <circle className="brand-mark-dot" cx="24.5" cy="22.5" r="2.4" />
  </svg>;
}
