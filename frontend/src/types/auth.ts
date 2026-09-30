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
}

export interface AuthResponse {
  user: User;
}
