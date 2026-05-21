import type {
  ESignProvider,
  ESignSession,
  ESignVerifyInput,
  ESignVerifyResult,
  InitiateESignInput
} from "./e-sign.adapter";

// Dev-only Aadhaar eSign stub. Accepts ANY 6-digit OTP starting with '1' as
// verified — gives the frontend a way to test both happy and error paths without
// real UIDAI integration. NEVER ship to production.

interface Deps {
  clock?: () => Date;
}

interface Session {
  sessionId: string;
  agreementId: string;
  status: "initiated" | "verified" | "expired";
  initiatedAt: Date;
  signedAt: Date | null;
}

export class MockESignProvider implements ESignProvider {
  private readonly clock: () => Date;
  private counter = 0;
  private readonly sessions = new Map<string, Session>();

  constructor(deps: Deps = {}) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async initiate(input: InitiateESignInput): Promise<ESignSession> {
    this.counter += 1;
    const sessionId = `MOCK-ESIGN-SESS-${this.counter}-${input.agreementId}`;
    const session: Session = {
      sessionId,
      agreementId: input.agreementId,
      status: "initiated",
      initiatedAt: this.clock(),
      signedAt: null
    };
    this.sessions.set(sessionId, session);
    return {
      sessionId,
      status: "initiated",
      initiatedAt: session.initiatedAt,
      otpUrl: `https://dev.cribliv.local/mock-aadhaar-otp?session=${sessionId}`
    };
  }

  async verify(input: ESignVerifyInput): Promise<ESignVerifyResult> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return { sessionId: input.sessionId, status: "expired", signedAt: null };
    }
    const otpValid = /^1\d{5}$/.test(input.otp);
    if (!otpValid) {
      return { sessionId: input.sessionId, status: session.status, signedAt: session.signedAt };
    }
    session.status = "verified";
    session.signedAt = this.clock();
    return { sessionId: input.sessionId, status: "verified", signedAt: session.signedAt };
  }
}
