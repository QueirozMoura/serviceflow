/** Metadados devolvidos pelo servidor nas listagens paginadas. */
export interface PageInfo { page: number; pageSize: number; total: number; totalPages: number; }

export interface PageParams { page: number; pageSize: number; q?: string; }
