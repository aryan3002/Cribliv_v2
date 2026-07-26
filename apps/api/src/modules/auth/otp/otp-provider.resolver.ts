import { Inject, Injectable } from "@nestjs/common";
import { D7OtpProvider } from "./d7-otp.provider";
import { MockOtpProvider } from "./mock-otp.provider";
import { WhatsAppOtpProvider } from "./whatsapp-otp.provider";
import {
  MARKER_PREFIX_D7,
  MARKER_PREFIX_WHATSAPP,
  type OtpProvider
} from "./otp-provider.interface";

/**
 * Chooses the channel for a send, and routes a verify back to whichever
 * channel issued that code.
 *
 * Pure with respect to its arguments: the caller supplies the recent WhatsApp
 * attempt count because AuthService owns the database. That keeps every gate
 * rule testable without a DB.
 */

/**
 * How many WhatsApp attempts a user must make before the SMS escape hatch is
 * offered. SMS costs ~43x a WhatsApp message on our current route, so the gate
 * exists to keep WhatsApp share high rather than to be user-hostile.
 */
export const WHATSAPP_ATTEMPTS_BEFORE_SMS = 2;

@Injectable()
export class OtpProviderResolver {
  constructor(
    @Inject(MockOtpProvider) private readonly mock: MockOtpProvider,
    @Inject(WhatsAppOtpProvider) private readonly whatsapp: WhatsAppOtpProvider,
    @Inject(D7OtpProvider) private readonly d7: D7OtpProvider
  ) {}

  forSend(input: {
    requestedChannel?: "whatsapp" | "sms";
    recentWhatsAppAttempts: number;
  }): OtpProvider {
    // Mock wins outright: local dev and E2E must never reach a real provider.
    if ((process.env.OTP_PROVIDER ?? "mock").trim().toLowerCase() === "mock") {
      return this.mock;
    }

    if (!this.whatsappIsPrimary()) {
      return this.d7;
    }

    // The gate is enforced here, server-side, so a client cannot reach the
    // expensive channel just by asking for it.
    if (
      input.requestedChannel === "sms" &&
      this.isSmsFallbackAvailable(input.recentWhatsAppAttempts)
    ) {
      return this.d7;
    }

    return this.whatsapp;
  }

  isSmsFallbackAvailable(recentWhatsAppAttempts: number): boolean {
    if (!this.whatsappIsPrimary()) {
      return false;
    }
    return recentWhatsAppAttempts >= WHATSAPP_ATTEMPTS_BEFORE_SMS;
  }

  /**
   * The SMS provider, bypassing the gate. Used only by AuthService when Meta
   * reports the recipient permanently undeliverable on WhatsApp.
   */
  sms(): OtpProvider {
    return this.d7;
  }

  forMarker(marker: string): OtpProvider {
    if (marker.startsWith(MARKER_PREFIX_WHATSAPP)) {
      return this.whatsapp;
    }
    if (marker.startsWith(MARKER_PREFIX_D7)) {
      return this.d7;
    }
    return this.mock;
  }

  private whatsappIsPrimary(): boolean {
    return (process.env.OTP_CHANNEL_PRIMARY ?? "sms").trim().toLowerCase() === "whatsapp";
  }
}
