export function normalizeDecimalInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s/g, '') ?? '';
  if (!trimmed) return null;

  const commaIndex = trimmed.lastIndexOf(',');
  const dotIndex = trimmed.lastIndexOf('.');

  if (commaIndex >= 0 && dotIndex >= 0) {
    return commaIndex > dotIndex ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed.replaceAll(',', '');
  }

  const separatorIndex = Math.max(commaIndex, dotIndex);
  if (separatorIndex < 0) return trimmed;

  const integerPart = trimmed.slice(0, separatorIndex);
  const fractionPart = trimmed.slice(separatorIndex + 1);
  const separator = trimmed[separatorIndex];

  if (fractionPart.length === 3 && integerPart.length <= 3) return trimmed.replace(separator, '');
  return separator === ',' ? trimmed.replace(',', '.') : trimmed;
}
