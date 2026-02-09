export type Role = "tenant" | "owner" | "pg_operator" | "admin";

export interface UserContext {
  id: string;
  role: Role;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}
