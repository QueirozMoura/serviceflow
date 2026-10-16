export type UserRole = 'OWNER' | 'ADMIN' | 'TECHNICIAN' | 'STAFF';

export interface Organization {
  id: string;
  name: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole | string;
  organizationId: string;
  organization?: Organization;
  /** Permissões efetivas do papel, calculadas pelo backend (somente para a interface). */
  permissions?: string[];
}

export interface AuthResponse {
  user: User;
}
