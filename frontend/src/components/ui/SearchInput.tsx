import { Search, X } from 'lucide-react';

interface SearchInputProps { value: string; onChange: (value: string) => void; placeholder: string; }
export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return <div className="search-input"><Search size={17} aria-hidden="true" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />{value ? <button type="button" aria-label="Limpar busca" onClick={() => onChange('')}><X size={15} /></button> : null}</div>;
}
