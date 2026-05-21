import type { ApiRequest } from "./client";
import type { Locale, PlanId, Party, Provider } from "./types";

interface SignatureBody {
  party: Party;
  method: "canvas" | "upload";
  image_b64: string;
  content_type: "image/png" | "image/jpeg";
}

export const RentAgreementApi = {
  plans: (): ApiRequest => ({ method: "GET", path: "/rent-agreement/plans" }),
  states: (): ApiRequest => ({ method: "GET", path: "/rent-agreement/states" }),
  stampDuty: (q: { state: string; rent: number; tenure: number; deposit?: number }): ApiRequest => {
    const parts = [`state=${encodeURIComponent(q.state)}`, `rent=${q.rent}`, `tenure=${q.tenure}`];
    if (q.deposit !== undefined) parts.push(`deposit=${q.deposit}`);
    return { method: "GET", path: `/rent-agreement/stamp-duty?${parts.join("&")}` };
  },
  createDraft: (body: { plan_id: PlanId; locale: Locale }, idempotencyKey: string): ApiRequest => ({
    method: "POST",
    path: "/rent-agreement/draft",
    body,
    idempotencyKey
  }),
  myDrafts: (): ApiRequest => ({ method: "GET", path: "/rent-agreement/my" }),
  getDraft: (id: string): ApiRequest => ({ method: "GET", path: `/rent-agreement/${id}` }),
  patchStep: (id: string, step: number, body: unknown): ApiRequest => ({
    method: "PATCH",
    path: `/rent-agreement/${id}/step/${step}`,
    body
  }),
  advanceStep: (id: string, step: number, body: unknown): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/step/${step}/advance`,
    body
  }),
  backStep: (id: string, step: number): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/step/${step}/back`
  }),
  signature: (id: string, body: SignatureBody): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/signature`,
    body
  }),
  checkout: (id: string, body: { provider: Provider }, idempotencyKey: string): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/checkout`,
    body,
    idempotencyKey
  }),
  status: (id: string): ApiRequest => ({ method: "GET", path: `/rent-agreement/${id}/status` }),
  download: (id: string): ApiRequest => ({ method: "GET", path: `/rent-agreement/${id}/download` }),
  preview: (id: string): ApiRequest => ({ method: "GET", path: `/rent-agreement/${id}/preview` }),
  eStampIssue: (id: string): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/e-stamp/issue`
  }),
  eStampStatus: (id: string): ApiRequest => ({
    method: "GET",
    path: `/rent-agreement/${id}/e-stamp/status`
  }),
  eSignInitiate: (id: string, party: Party): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/e-sign/initiate`,
    body: { party }
  }),
  eSignVerify: (id: string, otp: string): ApiRequest => ({
    method: "POST",
    path: `/rent-agreement/${id}/e-sign/verify`,
    body: { otp }
  }),
  devBootstrap: (): ApiRequest => ({ method: "GET", path: "/rent-agreement/_dev/bootstrap" })
};
