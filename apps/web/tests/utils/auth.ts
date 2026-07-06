import { type APIRequestContext, type Page, expect } from "@playwright/test";

type Role = "tenant" | "owner" | "pg_operator" | "admin";

interface OtpSendResponse {
  challenge_id: string;
  dev_otp?: string;
}

interface OtpVerifyResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    role: Role;
    phone_e164: string;
    preferred_language: "en" | "hi";
  };
}

const ROLE_PHONE: Record<Role, string> = {
  tenant: "+919999999902",
  owner: "+919999999901",
  pg_operator: "+919999999904",
  admin: "+919999999903"
};

const AUTH_STORAGE_KEY = "cribliv:auth-session";

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getWebBaseUrl() {
  const raw = process.env.E2E_BASE_URL || "http://localhost:3000";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export async function loginWithOtp(request: APIRequestContext, phone: string, purpose = "login") {
  const sendResponse = await request.post(`${getApiBaseUrl()}/auth/otp/send`, {
    data: {
      phone_e164: phone,
      purpose
    }
  });
  expect(sendResponse.ok()).toBeTruthy();

  const sendJson = await sendResponse.json();
  const sendData = sendJson?.data as OtpSendResponse;
  const otpCode = sendData?.dev_otp;
  expect(sendData?.challenge_id).toBeTruthy();
  if (!otpCode) {
    throw new Error(
      "OTP send response did not include dev_otp. Run E2E with OTP_PROVIDER=mock for test login."
    );
  }

  const verifyResponse = await request.post(`${getApiBaseUrl()}/auth/otp/verify`, {
    data: {
      challenge_id: sendData.challenge_id,
      otp_code: otpCode,
      device_fingerprint: "playwright"
    }
  });
  expect(verifyResponse.ok()).toBeTruthy();

  const verifyJson = await verifyResponse.json();
  return verifyJson?.data as OtpVerifyResponse;
}

export async function loginAsRole(request: APIRequestContext, role: Role) {
  const session = await loginWithOtp(request, ROLE_PHONE[role]);
  if (session.user.role !== role) {
    throw new Error(
      `Expected role ${role} but got ${session.user.role}. Use in-memory API mode for E2E seeded users.`
    );
  }
  return session;
}

export async function setSessionOnPage(page: Page, session: OtpVerifyResponse) {
  const nextAuthChallenge = await page.context().request.post(`${getApiBaseUrl()}/auth/otp/send`, {
    data: {
      phone_e164: session.user.phone_e164,
      purpose: "login"
    }
  });
  expect(nextAuthChallenge.ok()).toBeTruthy();

  const challengeJson = await nextAuthChallenge.json();
  const challengeData = challengeJson?.data as OtpSendResponse;
  expect(challengeData?.challenge_id).toBeTruthy();
  if (!challengeData?.dev_otp) {
    throw new Error(
      "OTP send response did not include dev_otp. Run E2E with OTP_PROVIDER=mock for test login."
    );
  }

  const csrfResponse = await page.context().request.get(`${getWebBaseUrl()}/api/auth/csrf`);
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfJson = (await csrfResponse.json()) as { csrfToken?: string };
  const csrfToken = csrfJson.csrfToken;
  if (!csrfToken) {
    throw new Error("NextAuth CSRF endpoint did not return a token.");
  }

  const callbackResponse = await page
    .context()
    .request.post(`${getWebBaseUrl()}/api/auth/callback/credentials`, {
      form: {
        csrfToken,
        challengeId: challengeData.challenge_id,
        otpCode: challengeData.dev_otp,
        phone: session.user.phone_e164,
        redirect: "false",
        json: "true"
      }
    });
  expect(callbackResponse.ok()).toBeTruthy();

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: AUTH_STORAGE_KEY,
      value: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: session.user
      }
    }
  );
}
