export interface AuthUser {
  id: string;
  role: string;
}

export interface AuthPort {
  getAccessToken(): Promise<string | null>;
  getUser(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
}
