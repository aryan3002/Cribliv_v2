import type { AuthPort, AuthUser } from "./auth-port";

export class DevAuthAdapter implements AuthPort {
  private cachedToken: string | null = null;
  private cachedUser: AuthUser | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly baseUrl: string) {}

  async getAccessToken(): Promise<string | null> {
    if (this.cachedToken) return this.cachedToken;
    await this.bootstrap();
    return this.cachedToken;
  }

  async getUser(): Promise<AuthUser | null> {
    if (this.cachedUser) return this.cachedUser;
    await this.bootstrap();
    return this.cachedUser;
  }

  async signOut(): Promise<void> {
    this.cachedToken = null;
    this.cachedUser = null;
    this.inflight = null;
  }

  private async bootstrap(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const res = await fetch(`${this.baseUrl}/rent-agreement/_dev/bootstrap`);
      if (!res.ok) throw new Error(`bootstrap failed: HTTP ${res.status}`);
      const json = await res.json();
      this.cachedToken = json.data.access_token;
      this.cachedUser = json.data.user;
    })();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }
}
