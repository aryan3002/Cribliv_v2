// Unmet rental demand expressed on the voice map: the precise spec a seeker
// asked for that we could not satisfy, plus an optional phone for
// owner-acquisition follow-up. This is the demand-sensing output of the
// Maya voice map feature. See infra/migrations/0060_demand_signals.sql.

export interface CreateDemandSignalDto {
  city?: string;
  locality?: string;
  filters: Record<string, unknown>;
  unmet?: string;
  transcript?: string;
  phone?: string;
  source?: string;
}

export interface DemandSignal extends CreateDemandSignalDto {
  id: string;
  created_at: string;
}
