import type { Queryable, RentActor } from "./rent-guards";

export interface RentEventInput {
  propertyId: string;
  entityType: "invoice" | "payment" | "expense" | "settings" | "assignment" | "receipt";
  entityId: string;
  eventType: string;
  actor: RentActor;
  payload?: Record<string, unknown>;
}

/** Invariant 8: called inside the mutating transaction, never after it. */
export async function writeRentEvent(client: Queryable, input: RentEventInput): Promise<void> {
  await client.query(
    `INSERT INTO pg_rent_events
       (pg_property_id, entity_type, entity_id, event_type, actor_user_id, actor_role, payload)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7::jsonb)`,
    [
      input.propertyId,
      input.entityType,
      input.entityId,
      input.eventType,
      input.actor.id,
      input.actor.role,
      JSON.stringify(input.payload ?? {})
    ]
  );
}
