import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { readFeatureFlags } from "../../config/feature-flags";

export type SalesLeadSource = "pg_sales_assist" | "property_management";
export type SalesLeadStatus = "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";

@Injectable()
export class SalesService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  async createLead(input: {
    createdByUserId: string;
    listingId?: string;
    source: SalesLeadSource;
    notes?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    const flags = readFeatureFlags();
    if (!flags.ff_pg_sales_leads) {
      throw new BadRequestException({
        code: "sales_leads_disabled",
        message: "Sales lead capture is disabled"
      });
    }

    if (this.database.isEnabled()) {
      if (input.listingId) {
        const listing = await this.database.query<{ id: string }>(
          `
          SELECT id::text
          FROM listings
          WHERE id = $1::uuid
            AND owner_user_id = $2::uuid
          LIMIT 1
          `,
          [input.listingId, input.createdByUserId]
        );
        if (!listing.rowCount) {
          throw new NotFoundException({ code: "not_found", message: "Listing not found" });
        }
      }

      const inserted = await this.database.query<{
        id: string;
        status: SalesLeadStatus;
        source: SalesLeadSource;
        listing_id: string | null;
        created_at: string;
      }>(
        `
        INSERT INTO sales_leads(
          created_by_user_id,
          listing_id,
          source,
          status,
          idempotency_key,
          notes,
          metadata
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::sales_lead_source,
          'new',
          $4,
          $5,
          $6::jsonb
        )
        ON CONFLICT (created_by_user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING id::text, status::text, source::text, listing_id::text, created_at::text
        `,
        [
          input.createdByUserId,
          input.listingId ?? null,
          input.source,
          input.idempotencyKey ?? null,
          input.notes ?? null,
          JSON.stringify(input.metadata ?? {})
        ]
      );

      const lead =
        inserted.rows[0] ??
        (
          await this.database.query<{
            id: string;
            status: SalesLeadStatus;
            source: SalesLeadSource;
            listing_id: string | null;
            created_at: string;
          }>(
            `
            SELECT id::text, status::text, source::text, listing_id::text, created_at::text
            FROM sales_leads
            WHERE created_by_user_id = $1::uuid
              AND idempotency_key = $2
            LIMIT 1
            `,
            [input.createdByUserId, input.idempotencyKey ?? null]
          )
        ).rows[0];

      await this.enqueueOutboundEvent({
        eventType: "crm.sales_lead.created",
        aggregateType: "sales_lead",
        aggregateId: lead.id,
        dedupeKey: `sales_lead_created:${lead.id}`,
        payload: {
          lead_id: lead.id,
          created_by_user_id: input.createdByUserId,
          listing_id: lead.listing_id,
          source: lead.source,
          status: lead.status,
          notes: input.notes ?? null,
          metadata: input.metadata ?? {},
          created_at: lead.created_at
        }
      });

      logTelemetry("sales.lead_created", {
        lead_id: lead.id,
        source: lead.source,
        listing_id: lead.listing_id
      });

      return {
        id: lead.id,
        status: lead.status,
        source: lead.source,
        listing_id: lead.listing_id,
        created_at: lead.created_at
      };
    }

    const lead = this.appState.createSalesLead({
      createdByUserId: input.createdByUserId,
      listingId: input.listingId,
      source: input.source,
      notes: input.notes,
      metadata: input.metadata,
      idempotencyKey: input.idempotencyKey
    });
    this.appState.enqueueOutboundEvent({
      eventType: "crm.sales_lead.created",
      aggregateType: "sales_lead",
      aggregateId: lead.id,
      payload: {
        lead_id: lead.id,
        created_by_user_id: input.createdByUserId,
        listing_id: lead.listingId ?? null,
        source: lead.source,
        status: lead.status,
        notes: lead.notes ?? null,
        metadata: lead.metadata
      }
    });

    return {
      id: lead.id,
      status: lead.status,
      source: lead.source,
      listing_id: lead.listingId ?? null,
      created_at: new Date(lead.createdAt).toISOString()
    };
  }

  private async enqueueOutboundEvent(input: {
    eventType: string;
    aggregateType: string;
    aggregateId?: string;
    dedupeKey?: string;
    payload: Record<string, unknown>;
  }) {
    if (this.database.isEnabled()) {
      await this.database.query(
        `
        INSERT INTO outbound_events(
          event_type,
          aggregate_type,
          aggregate_id,
          dedupe_key,
          payload,
          status,
          next_attempt_at
        )
        VALUES (
          $1,
          $2,
          $3::uuid,
          $4,
          $5::jsonb,
          'pending',
          now()
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        `,
        [
          input.eventType,
          input.aggregateType,
          input.aggregateId ?? null,
          input.dedupeKey ?? null,
          JSON.stringify(input.payload)
        ]
      );
    }
  }
}
