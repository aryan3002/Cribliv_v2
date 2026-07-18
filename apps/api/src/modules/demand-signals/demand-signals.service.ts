import { Inject, Injectable } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";

@Injectable()
export class DemandSignalsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService
  ) {}

  async create(dto: CreateDemandSignalDto): Promise<{ id: string; created_at: string }> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{ id: string; created_at: string }>(
        `INSERT INTO demand_signals (city, locality, filters, unmet, transcript, phone, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [
          dto.city ?? null,
          dto.locality ?? null,
          JSON.stringify(dto.filters ?? {}),
          dto.unmet ?? null,
          dto.transcript ?? null,
          dto.phone ?? null,
          dto.source ?? "voice_map"
        ]
      );
      const row = result.rows[0];
      return { id: row.id, created_at: row.created_at };
    }

    const id = `sig_${this.appState.demandSignals.length + 1}`;
    const created_at = new Date().toISOString();
    const signal = {
      ...dto,
      filters: dto.filters ?? {},
      source: dto.source ?? "voice_map",
      id,
      created_at
    };
    this.appState.demandSignals.push(signal);
    return { id, created_at };
  }
}
