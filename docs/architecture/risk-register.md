# Phase 1 Risk Register

| Risk                         | Mitigation                                    | Kill Switch                       |
| ---------------------------- | --------------------------------------------- | --------------------------------- |
| Agentic misrouting           | confidence threshold + deterministic fallback | `ff_agentic_router_enabled=false` |
| OTP abuse                    | phone/IP/device throttling and cooldown       | `ff_otp_send_enabled=false`       |
| No-response refund spike     | owner response tracking + quality rules       | `ff_auto_refund_enabled=false`    |
| Duplicate debit              | idempotency + unique constraints              | `ff_contact_unlock_enabled=false` |
| Verification false negatives | 85% threshold + manual override               | `ff_bill_match_blocking=false`    |
