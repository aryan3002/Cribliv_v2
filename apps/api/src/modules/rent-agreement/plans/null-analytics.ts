// No-op analytics for the period while Phase 10 (PostHog) is skipped.
// Phase 10's real RentAgreementPostHogService will satisfy this same interface.

export interface RentAgreementAnalyticsPort {
  emit(eventName: string, properties: Record<string, unknown>): Promise<void>;
}

export const nullAnalytics: RentAgreementAnalyticsPort = {
  async emit(): Promise<void> {
    // Phase 10 will replace with real PostHog + DB event-log mirror.
  }
};
