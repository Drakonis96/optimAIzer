export type UserRole = 'admin' | 'user';

export interface ModelAllowlistByProvider {
  [providerId: string]: string[];
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  monthlyCostLimitUsd: number;
  modelAllowlistByProvider: ModelAllowlistByProvider;
  createdAt: number;
  updatedAt: number;
}
