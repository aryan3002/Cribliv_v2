"use client";

import { useEffect, useState } from "react";
import {
  canOfferSmsFallback,
  resendLabel,
  type OtpChannel,
  type OtpSendData
} from "../../lib/otp-channel";

/**
 * Resend + SMS-fallback controls shown under the OTP input.
 *
 * The SMS option is deliberately hidden until the server says it has been
 * earned (two WhatsApp attempts). WhatsApp costs a fraction of an SMS, so
 * surfacing the expensive channel early would quietly undo the saving — and
 * the server would refuse the request anyway.
 */
export function OtpChannelActions({
  data,
  phone,
  loading,
  onResend
}: {
  data: OtpSendData | null;
  phone: string;
  loading: boolean;
  /** Re-requests a code. `channel` is omitted for a plain resend. */
  onResend: (channel?: "sms") => void | Promise<void>;
}) {
  const retryAfter = data?.retry_after_sec ?? 30;
  const [secondsLeft, setSecondsLeft] = useState(retryAfter);

  // Restart the countdown whenever a new code is issued.
  useEffect(() => {
    if (!data?.challenge_id) return;
    setSecondsLeft(data.retry_after_sec ?? 30);
  }, [data?.challenge_id, data?.retry_after_sec]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  if (!data) return null;

  const channel: OtpChannel | undefined = data.channel;
  const canResend = secondsLeft <= 0 && !loading;

  return (
    <div className="otp-channel-actions">
      <button
        type="button"
        onClick={() => onResend()}
        disabled={!canResend}
        className="otp-channel-actions__resend"
      >
        {secondsLeft > 0 ? `${resendLabel(channel)} in ${secondsLeft}s` : resendLabel(channel)}
      </button>

      {canOfferSmsFallback(data) && (
        <button
          type="button"
          onClick={() => onResend("sms")}
          disabled={loading}
          className="otp-channel-actions__sms"
        >
          Didn&apos;t get it? Send by SMS instead
        </button>
      )}
    </div>
  );
}
