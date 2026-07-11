const RAZORPAY_SCRIPT_ID = "razorpay-sdk";
const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// Shared across concurrent callers so two components racing to open Checkout
// (e.g. a dialog mounting while another panel is mid-load) attach exactly one
// <script> tag and both resolve off the same load/error event, instead of
// each appending its own duplicate tag.
let inFlightLoad: Promise<boolean> | null = null;

/**
 * Loads the Razorpay Checkout SDK, memoizing concurrent calls onto one
 * in-flight promise. Resolves `true` only once `window.Razorpay` is actually
 * present (not merely once the script tag fires `load` — some blockers let
 * the request "succeed" with an empty body). On any failure the script node
 * is removed so a later retry attaches a fresh one rather than being wedged
 * behind a dead tag with `id="razorpay-sdk"`.
 */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = new Promise<boolean>((resolve) => {
    const existing = document.getElementById(RAZORPAY_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.id = RAZORPAY_SCRIPT_ID;
    script.src = RAZORPAY_SCRIPT_SRC;
    script.onload = () => {
      const success = Boolean(window.Razorpay);
      if (!success) script.remove();
      resolve(success);
    };
    script.onerror = () => {
      script.remove();
      resolve(false);
    };
    if (!existing) {
      document.body.appendChild(script);
    }
  }).finally(() => {
    inFlightLoad = null;
  });

  return inFlightLoad;
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id?: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayCheckoutOptions) => { open(): void };
  }
}

export function openRazorpayCheckout(options: RazorpayCheckoutOptions): void {
  const rzp = new window.Razorpay(options);
  rzp.open();
}
