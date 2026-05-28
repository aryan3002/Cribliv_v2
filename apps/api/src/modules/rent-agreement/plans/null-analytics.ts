// Analytics port for the rent-agreement module.
//
// `nullAnalytics` is the no-op fallback used whenever the DB is disabled (and as
// the controller's @Optional() default). `RentAgreementDbAnalyticsService` is the
// real implementation — it writes rent_agreement_event_log + rent_agreement_step_audit.

export interface StepAuditEntry {
  agreementId: string;
  step: number;
  outcome: "advanced" | "blocked" | "patched" | "reverted";
  actorUserId: string;
  errorCodes?: string[];
  metadata?: Record<string, unknown>;
}

export interface RentAgreementAnalyticsPort {
  emit(eventName: string, properties: Record<string, unknown>): Promise<void>;
  emitStepAudit(entry: StepAuditEntry): Promise<void>;
}

export const nullAnalytics: RentAgreementAnalyticsPort = {
  async emit(): Promise<void> {
    // no-op
  },
  async emitStepAudit(): Promise<void> {
    // no-op
  }
};
