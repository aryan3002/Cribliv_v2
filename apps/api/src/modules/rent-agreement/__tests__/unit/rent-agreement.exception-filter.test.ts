import { describe, it, expect, vi } from "vitest";
import { UnauthorizedException, type ArgumentsHost } from "@nestjs/common";
import { RentAgreementExceptionFilter } from "../../rent-agreement.exception-filter";

function mockHost() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { res, host };
}

describe("RentAgreementExceptionFilter", () => {
  const filter = new RentAgreementExceptionFilter();

  it("maps a RENT_AGREEMENT_* coded error to its HTTP status", () => {
    const { res, host } = mockHost();
    const err = Object.assign(new Error("missing"), { code: "RENT_AGREEMENT_NOT_FOUND" });
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("handles an UnauthorizedException as 401 — never re-throws (re-throw crashes the process)", () => {
    const { res, host } = mockHost();
    expect(() =>
      filter.catch(new UnauthorizedException({ code: "unauthorized" }), host)
    ).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("falls back to 500 for an unknown error — never re-throws", () => {
    const { res, host } = mockHost();
    expect(() => filter.catch(new Error("boom"), host)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
