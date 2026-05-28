import {
  Injectable,
  Logger,
  BadGatewayException,
  ServiceUnavailableException
} from "@nestjs/common";
import { LISTING_TOOLS, buildInstructions, type BuildInstructionsInput } from "./realtime-tools";

/* ──────────────────────────────────────────────────────────────────────
 * RealtimeSessionService
 *
 * Handles the full WebRTC handshake for the Azure OpenAI Realtime API.
 *
 * Flow:
 *   1. Browser creates RTCPeerConnection + SDP offer
 *   2. Browser POSTs SDP offer to our /realtime/connect endpoint
 *   3. This service mints an ephemeral token from Azure
 *   4. This service forwards the SDP offer to Azure's /calls endpoint
 *   5. Returns the SDP answer + metadata to the browser
 *   6. Browser sets remote description — WebRTC connection is established
 *
 * Why proxy through the backend:
 *   Azure's /calls endpoint does not emit CORS headers that allow
 *   browser-to-Azure direct requests from non-Azure origins (e.g.
 *   localhost or a custom domain). Proxying is also Azure's recommended
 *   production approach.
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-webrtc
 * ──────────────────────────────────────────────────────────────────── */

interface RealtimeConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  voice: string;
  timeoutMs: number;
}

const SUPPORTED_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar"
];

function readConfig(): RealtimeConfig {
  const rawEndpoint =
    process.env.AZURE_OPENAI_REALTIME_ENDPOINT?.trim() ||
    process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
    "";
  const rawApiKey =
    process.env.AZURE_OPENAI_REALTIME_API_KEY?.trim() ||
    process.env.AZURE_OPENAI_API_KEY?.trim() ||
    "";

  return {
    endpoint: rawEndpoint.replace(/\/+$/, ""),
    apiKey: rawApiKey,
    deployment: process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT?.trim() || "gpt-realtime-mini",
    voice: (process.env.AZURE_OPENAI_REALTIME_VOICE?.trim() || "sage").toLowerCase(),
    timeoutMs: Math.max(Number(process.env.AZURE_AI_TIMEOUT_MS) || 20000, 10000)
  };
}

export interface RealtimeConnectInput {
  userId: string;
  sdpOffer: string;
  currentStep: number;
  filledFields: Record<string, unknown>;
  missingFields: string[];
  locale: "en" | "hi";
  ownerFirstName?: string;
}

export interface RealtimeConnectResponse {
  sdp_answer: string;
  model: string;
  voice: string;
  tools: unknown[];
  locale: string;
}

@Injectable()
export class RealtimeSessionService {
  private readonly logger = new Logger(RealtimeSessionService.name);

  isConfigured(): boolean {
    const cfg = readConfig();
    return Boolean(cfg.endpoint && cfg.apiKey && cfg.deployment);
  }

  /**
   * Full WebRTC handshake proxy:
   *   1. Mint an ephemeral token from Azure
   *   2. Forward the browser's SDP offer to Azure's /calls endpoint
   *   3. Return the SDP answer to the browser
   */
  async connect(input: RealtimeConnectInput): Promise<RealtimeConnectResponse> {
    const cfg = readConfig();
    if (!cfg.endpoint || !cfg.apiKey) {
      throw new ServiceUnavailableException(
        "Azure OpenAI Realtime is not configured (missing endpoint or API key)."
      );
    }
    if (!input.sdpOffer?.trim()) {
      throw new BadGatewayException("SDP offer is required.");
    }

    const voice = SUPPORTED_VOICES.includes(cfg.voice) ? cfg.voice : "sage";

    const instructionsInput: BuildInstructionsInput = {
      currentStep: Math.max(0, Math.min(5, input.currentStep)),
      filledFields: input.filledFields ?? {},
      missingFields: input.missingFields ?? [],
      locale: input.locale === "hi" ? "hi" : "en",
      ownerFirstName: input.ownerFirstName
    };

    // Azure client_secrets only accepts type/model/instructions/audio.output.voice.
    // All other config (tools, VAD, transcription) is pushed via session.update
    // over the data channel after the WebRTC connection opens.
    const sessionConfig = {
      session: {
        type: "realtime",
        model: cfg.deployment,
        instructions: buildInstructions(instructionsInput),
        audio: {
          output: { voice }
        }
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      // ── Step 1: Mint ephemeral token ──────────────────────────────
      const tokenUrl = `${cfg.endpoint}/openai/v1/realtime/client_secrets`;
      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": cfg.apiKey
        },
        body: JSON.stringify(sessionConfig),
        signal: controller.signal
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => "");
        this.logger.error(
          `Azure Realtime client_secrets failed (${tokenRes.status}): ${text.slice(0, 400)}`
        );
        throw new BadGatewayException(
          `Azure Realtime session rejected (${tokenRes.status}). Check deployment '${cfg.deployment}' and region.`
        );
      }

      const tokenData = (await tokenRes.json()) as { value?: string; expires_at?: number };
      if (!tokenData?.value) {
        throw new BadGatewayException("Azure Realtime API returned no ephemeral key.");
      }

      this.logger.log(
        `Ephemeral token minted for user=${input.userId} step=${input.currentStep} model=${cfg.deployment}`
      );

      // ── Step 2: Forward SDP offer to Azure's calls endpoint ───────
      const callsUrl = `${cfg.endpoint}/openai/v1/realtime/calls`;
      const sdpRes = await fetch(callsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          Authorization: `Bearer ${tokenData.value}`
        },
        body: input.sdpOffer,
        signal: controller.signal
      });

      if (!sdpRes.ok) {
        const text = await sdpRes.text().catch(() => "");
        this.logger.error(`Azure Realtime calls failed (${sdpRes.status}): ${text.slice(0, 400)}`);
        throw new BadGatewayException(
          `WebRTC negotiation failed (${sdpRes.status}). Azure rejected the SDP offer.`
        );
      }

      const sdpAnswer = await sdpRes.text();
      if (!sdpAnswer?.trim()) {
        throw new BadGatewayException("Azure Realtime API returned an empty SDP answer.");
      }

      this.logger.log(`WebRTC session established for user=${input.userId}`);

      return {
        sdp_answer: sdpAnswer,
        model: cfg.deployment,
        voice,
        tools: LISTING_TOOLS,
        locale: input.locale
      };
    } catch (err) {
      if (err instanceof BadGatewayException || err instanceof ServiceUnavailableException)
        throw err;
      const msg = (err as Error).message ?? "Unknown error";
      this.logger.error(`Realtime connect error: ${msg}`);
      throw new BadGatewayException(
        "Could not establish the voice session. Please try again or use the form."
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
