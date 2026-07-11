import { HttpException, HttpStatus, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";

const RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders";
const DEFAULT_TIMEOUT_MS = 8000;

type RazorpayOrdersMode = "mock" | "live";

export interface CreateRazorpayOrderInput {
  amountPaise: number;
  receipt: string;
  planId: string;
  credits: number;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: "INR";
}

function providerErrorException(message: string, details?: Record<string, unknown>) {
  return new HttpException(
    {
      code: "payment_provider_error",
      message,
      ...(details ? { details } : {})
    },
    HttpStatus.BAD_GATEWAY
  );
}

/**
 * Thin client over Razorpay's Orders API (https://api.razorpay.com/v1/orders).
 *
 * Mode is controlled by RAZORPAY_ORDERS_MODE (mock|live); defaults to `mock`
 * outside production and `live` in production. `mock` never calls out to
 * Razorpay — it returns a deterministic `order_mock_*` id so local/dev/test
 * flows work without credentials.
 */
@Injectable()
export class RazorpayOrdersService {
  private readonly fetchImpl: typeof fetch;

  constructor(@Optional() fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private mode(): RazorpayOrdersMode {
    const configured = process.env.RAZORPAY_ORDERS_MODE?.trim().toLowerCase();
    if (configured === "mock" || configured === "live") {
      return configured;
    }
    return process.env.NODE_ENV === "production" ? "live" : "mock";
  }

  keyId(): string {
    return process.env.RAZORPAY_KEY_ID?.trim() || "rzp_test_placeholder";
  }

  async createOrder(input: CreateRazorpayOrderInput): Promise<RazorpayOrder> {
    if (this.mode() === "mock") {
      return this.createMockOrder(input);
    }

    return this.createLiveOrder(input);
  }

  private createMockOrder(input: CreateRazorpayOrderInput): RazorpayOrder {
    return {
      id: `order_mock_${randomUUID().replace(/-/g, "")}`,
      amount: input.amountPaise,
      currency: "INR"
    };
  }

  private async createLiveOrder(input: CreateRazorpayOrderInput): Promise<RazorpayOrder> {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      throw new HttpException(
        {
          code: "payment_provider_not_configured",
          message: "Razorpay credentials are not configured"
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const timeoutMs = Number(process.env.RAZORPAY_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    try {
      const response = await this.fetchImpl(RAZORPAY_ORDERS_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: "INR",
          receipt: input.receipt,
          notes: {
            plan_id: input.planId,
            credits_to_grant: String(input.credits)
          }
        }),
        signal: controller.signal
      });

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw providerErrorException("Razorpay returned a malformed response");
      }

      if (!response.ok) {
        throw providerErrorException("Razorpay order creation failed", {
          status: response.status
        });
      }

      const parsed = (json ?? {}) as { id?: unknown; amount?: unknown; currency?: unknown };
      if (
        typeof parsed.id !== "string" ||
        !parsed.id.trim() ||
        typeof parsed.amount !== "number" ||
        parsed.currency !== "INR"
      ) {
        throw providerErrorException("Razorpay returned an unexpected order shape");
      }

      return { id: parsed.id, amount: parsed.amount, currency: "INR" };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Covers AbortError (timeout) and any network-level failure.
      throw providerErrorException("Razorpay order request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
