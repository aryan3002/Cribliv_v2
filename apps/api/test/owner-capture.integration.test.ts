import "reflect-metadata";
import { BadGatewayException, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { AzureOpenAiExtractorClient } from "../src/modules/owner/azure-openai-extractor.client";
import { AzureSpeechClient } from "../src/modules/owner/azure-speech.client";

interface OtpSendData {
  challenge_id: string;
  dev_otp: string;
}

interface OtpVerifyData {
  access_token: string;
}

function getErrorCode(body: any): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  return (
    body.code ??
    body.error?.code ??
    body.message?.code ??
    body.response?.code ??
    body.response?.message?.code
  );
}

async function createApp(
  overrides: {
    ffCaptureEnabled?: boolean;
    speechClient?: Partial<AzureSpeechClient>;
    extractorClient?: Partial<AzureOpenAiExtractorClient>;
  } = {}
) {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.FF_OWNER_LISTING_ASSISTED_CAPTURE = overrides.ffCaptureEnabled ? "true" : "false";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule]
  })
    .overrideProvider(AzureSpeechClient)
    .useValue({
      transcribe: vi.fn().mockResolvedValue("Noida 2BHK rent 18000"),
      ...(overrides.speechClient ?? {})
    })
    .overrideProvider(AzureOpenAiExtractorClient)
    .useValue({
      extractDraft: vi.fn().mockResolvedValue({
        draft_suggestion: {
          listing_type: "flat_house",
          title: "2BHK in noida",
          rent: 18000,
          location: { city: "noida", locality: "sector-62" }
        },
        field_confidence: {
          listing_type: 0.95,
          title: 0.92,
          rent: 0.9,
          "location.city": 0.9,
          "location.locality": 0.7
        },
        critical_warnings: []
      }),
      ...(overrides.extractorClient ?? {})
    });

  const moduleRef = await moduleBuilder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}

async function loginOwner(app: INestApplication) {
  const sendRes = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: "+919999999901", purpose: "login" })
    .expect(201);
  const sendData = sendRes.body.data as OtpSendData;
  const verifyRes = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: sendData.challenge_id,
      otp_code: sendData.dev_otp,
      device_fingerprint: "capture-int-test"
    })
    .expect(201);
  return verifyRes.body.data as OtpVerifyData;
}

describe("Owner capture endpoint", () => {
  afterEach(() => {
    delete process.env.FF_OWNER_LISTING_ASSISTED_CAPTURE;
    delete process.env.OTP_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  it("returns extracted draft response when feature is enabled", async () => {
    const app = await createApp({ ffCaptureEnabled: true });
    try {
      const ownerSession = await loginOwner(app);
      const response = await http(app)
        .post("/v1/owner/listings/capture/extract")
        .set("Authorization", `Bearer ${ownerSession.access_token}`)
        .field("locale", "hi-IN")
        .attach("audio", Buffer.from("fake-audio"), {
          filename: "sample.webm",
          contentType: "audio/webm"
        });

      expect(response.status, JSON.stringify(response.body)).toBe(201);

      expect(response.body?.data?.draft_suggestion?.title).toBe("2BHK in noida");
      expect(response.body?.data?.confirm_fields).toContain("rent");
      expect(response.body?.data?.missing_required_fields).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("returns feature disabled when flag is off", async () => {
    const app = await createApp({ ffCaptureEnabled: false });
    try {
      const ownerSession = await loginOwner(app);
      const response = await http(app)
        .post("/v1/owner/listings/capture/extract")
        .set("Authorization", `Bearer ${ownerSession.access_token}`)
        .attach("audio", Buffer.from("fake-audio"), {
          filename: "sample.webm",
          contentType: "audio/webm"
        });

      expect(response.status, JSON.stringify(response.body)).toBe(404);

      expect(getErrorCode(response.body)).toBe("feature_disabled");
    } finally {
      await app.close();
    }
  });

  it("maps transcription provider failure to stable error shape", async () => {
    const app = await createApp({
      ffCaptureEnabled: true,
      speechClient: {
        transcribe: vi.fn().mockRejectedValue(
          new BadGatewayException({
            code: "voice_transcription_timeout",
            message: "Voice transcription timed out"
          })
        )
      }
    });
    try {
      const ownerSession = await loginOwner(app);
      const response = await http(app)
        .post("/v1/owner/listings/capture/extract")
        .set("Authorization", `Bearer ${ownerSession.access_token}`)
        .attach("audio", Buffer.from("fake-audio"), {
          filename: "sample.webm",
          contentType: "audio/webm"
        });

      expect(response.status, JSON.stringify(response.body)).toBe(502);
      expect(getErrorCode(response.body)).toBe("voice_transcription_timeout");
    } finally {
      await app.close();
    }
  });
});
