import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  PgBed,
  PgBedStatus,
  PgLayoutDraft,
  PgLayoutPutInput,
  PgLayoutRoomCountInput,
  PgRoom
} from "@cribliv/shared-types";
import type { PoolClient } from "pg";

import { DatabaseService } from "../../../common/database.service";

type RoomTypeRow = {
  id: string;
  sharing: "single" | "double" | "triple" | "quad" | "dorm";
  available_from: Date | string | null;
};

type RoomRow = {
  id: string;
  pg_property_id: string;
  room_type_id: string | null;
  floor: number | null;
  room_number: string;
  display_label: string | null;
  bed_count: number | null;
  status: "active" | "inactive";
  created_at: Date | string;
  updated_at: Date | string;
};

type BedRow = {
  id: string;
  room_id: string;
  bed_label: string;
  status: PgBedStatus;
  available_from: Date | string | null;
  sort_order: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const SHARING_BED_COUNTS = {
  single: 1,
  double: 2,
  triple: 3,
  quad: 4
} as const;

const DORM_BED_COUNT_FALLBACK = 6;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (!(value instanceof Date)) return value;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toBed(row: BedRow): PgBed {
  return {
    id: row.id,
    room_id: row.room_id,
    bed_label: row.bed_label,
    status: row.status,
    available_from: toDate(row.available_from),
    sort_order: row.sort_order,
    metadata: row.metadata ?? {},
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function bedLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

@Injectable()
export class PgLayoutService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: "operations_requires_db",
      message: "PG operations require a database"
    });
  }

  private async assertManagedOwnership(
    operatorId: string,
    propertyId: string,
    client?: PoolClient
  ): Promise<void> {
    const sql = `SELECT id
                   FROM pg_properties
                  WHERE id = $1::uuid
                    AND operator_id = $2::uuid
                    AND manage_enabled = true
                  LIMIT 1${client ? " FOR UPDATE" : ""}`;
    const result = client
      ? await client.query<{ id: string }>(sql, [propertyId, operatorId])
      : await this.db.query<{ id: string }>(sql, [propertyId, operatorId]);
    if (!result.rows[0]) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
  }

  private validateRoomCounts(roomCounts: PgLayoutRoomCountInput[]): void {
    for (const item of roomCounts) {
      if (!item.room_type_id || !Number.isInteger(item.count) || item.count < 1) {
        throw new BadRequestException({ code: "invalid_room_count" });
      }
      if (item.floor != null && !Number.isInteger(item.floor)) {
        throw new BadRequestException({ code: "invalid_floor" });
      }
      if (item.bed_count != null && (!Number.isInteger(item.bed_count) || item.bed_count < 1)) {
        throw new BadRequestException({ code: "invalid_bed_count" });
      }
    }
  }

  async generateDraft(
    operatorId: string,
    propertyId: string,
    roomCounts: PgLayoutRoomCountInput[]
  ): Promise<PgLayoutDraft> {
    if (!this.db.isEnabled()) {
      return { property_id: propertyId, room_counts: roomCounts, rooms: [] };
    }
    await this.assertManagedOwnership(operatorId, propertyId);
    this.validateRoomCounts(roomCounts);
    if (roomCounts.length === 0) {
      return { property_id: propertyId, room_counts: roomCounts, rooms: [] };
    }

    const typeIds = [...new Set(roomCounts.map((item) => item.room_type_id))];
    const result = await this.db.query<RoomTypeRow>(
      `SELECT rt.id::text, rt.sharing::text, rt.available_from
         FROM pg_room_types rt
         JOIN pg_listings l ON l.id = rt.listing_id
        WHERE l.pg_property_id = $1::uuid
          AND rt.id = ANY($2::uuid[])`,
      [propertyId, typeIds]
    );
    const roomTypes = new Map(result.rows.map((row) => [row.id, row]));
    if (roomTypes.size !== typeIds.length) {
      throw new BadRequestException({ code: "invalid_room_type" });
    }

    const floorCounters = new Map<number | null, number>();
    const rooms: PgLayoutDraft["rooms"] = [];
    for (const item of roomCounts) {
      const roomType = roomTypes.get(item.room_type_id)!;
      const floor = item.floor ?? null;
      for (let index = 0; index < item.count; index += 1) {
        const floorSequence = (floorCounters.get(floor) ?? 0) + 1;
        floorCounters.set(floor, floorSequence);
        const roomNumber =
          floor === null
            ? `R${String(floorSequence).padStart(3, "0")}`
            : `${floor}${String(floorSequence).padStart(2, "0")}`;
        // Dorm capacity is operator-supplied; six beds is the deterministic fallback.
        const bedsPerRoom =
          roomType.sharing === "dorm"
            ? (item.bed_count ?? DORM_BED_COUNT_FALLBACK)
            : SHARING_BED_COUNTS[roomType.sharing];

        rooms.push({
          room_type_id: roomType.id,
          floor,
          room_number: roomNumber,
          display_label: `Room ${roomNumber}`,
          bed_count: bedsPerRoom,
          beds: Array.from({ length: bedsPerRoom }, (_, bedIndex) => ({
            bed_label: bedLabel(bedIndex),
            status: "vacant" as const,
            available_from: toDate(roomType.available_from),
            sort_order: bedIndex + 1,
            metadata: {}
          }))
        });
      }
    }

    return { property_id: propertyId, room_counts: roomCounts, rooms };
  }

  async getLayout(operatorId: string, propertyId: string): Promise<PgRoom[]> {
    if (!this.db.isEnabled()) return [];
    await this.assertManagedOwnership(operatorId, propertyId);

    const rooms = await this.db.query<RoomRow>(
      `SELECT id::text, pg_property_id::text, room_type_id::text, floor, room_number,
              display_label, bed_count, status, created_at, updated_at
         FROM pg_rooms
        WHERE pg_property_id = $1::uuid
          AND status = 'active'
        ORDER BY floor ASC NULLS LAST, room_number ASC`,
      [propertyId]
    );
    if (rooms.rows.length === 0) return [];

    const beds = await this.db.query<BedRow>(
      `SELECT b.id::text, b.room_id::text, b.bed_label, b.status::text, b.available_from,
              b.sort_order, b.metadata, b.created_at, b.updated_at
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE r.pg_property_id = $1::uuid
          AND r.status = 'active'
          AND b.status <> 'inactive'
        ORDER BY r.floor ASC NULLS LAST, r.room_number ASC,
                 b.sort_order ASC NULLS LAST, b.bed_label ASC`,
      [propertyId]
    );
    const bedsByRoom = new Map<string, PgBed[]>();
    for (const row of beds.rows) {
      const roomBeds = bedsByRoom.get(row.room_id) ?? [];
      roomBeds.push(toBed(row));
      bedsByRoom.set(row.room_id, roomBeds);
    }

    return rooms.rows.map((row) => {
      const editableBeds = bedsByRoom.get(row.id) ?? [];
      return {
        id: row.id,
        pg_property_id: row.pg_property_id,
        room_type_id: row.room_type_id,
        floor: row.floor,
        room_number: row.room_number,
        display_label: row.display_label,
        bed_count: editableBeds.length,
        status: row.status,
        beds: editableBeds,
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at)
      };
    });
  }

  private validateDraft(draft: PgLayoutPutInput): void {
    if (!draft || !Array.isArray(draft.rooms)) {
      throw new BadRequestException({ code: "invalid_layout" });
    }
    const roomNumbers = new Set<string>();
    for (const room of draft.rooms) {
      const roomNumber = room.room_number?.trim();
      if (!roomNumber || roomNumbers.has(roomNumber)) {
        throw new BadRequestException({ code: "invalid_room_number" });
      }
      roomNumbers.add(roomNumber);
      if (!Array.isArray(room.beds) || room.bed_count !== room.beds.length) {
        throw new BadRequestException({ code: "bed_count_mismatch" });
      }
      const labels = new Set<string>();
      for (const bed of room.beds) {
        const label = bed.bed_label?.trim();
        if (!label || labels.has(label)) {
          throw new BadRequestException({ code: "invalid_bed_label" });
        }
        labels.add(label);
      }
    }
  }

  private async validateRoomTypes(
    client: PoolClient,
    propertyId: string,
    draft: PgLayoutPutInput
  ): Promise<void> {
    const roomTypeIds = [
      ...new Set(
        draft.rooms
          .map((room) => room.room_type_id)
          .filter((roomTypeId): roomTypeId is string => roomTypeId !== null)
      )
    ];
    if (roomTypeIds.length === 0) return;

    const result = await client.query<{ id: string }>(
      `SELECT rt.id::text
         FROM pg_room_types rt
         JOIN pg_listings l ON l.id = rt.listing_id
        WHERE l.pg_property_id = $1::uuid
          AND rt.id = ANY($2::uuid[])`,
      [propertyId, roomTypeIds]
    );
    if (result.rows.length !== roomTypeIds.length) {
      throw new BadRequestException({ code: "invalid_room_type" });
    }
  }

  private async retireOrDeleteBeds(client: PoolClient, bedIds: string[]): Promise<void> {
    if (bedIds.length === 0) return;
    await client.query(
      `UPDATE pg_beds b
          SET status = 'inactive'::pg_bed_status
        WHERE b.id = ANY($1::uuid[])
          AND EXISTS (SELECT 1 FROM pg_bed_assignments a WHERE a.bed_id = b.id)`,
      [bedIds]
    );
    await client.query(
      `DELETE FROM pg_beds b
        WHERE b.id = ANY($1::uuid[])
          AND b.status <> 'inactive'::pg_bed_status
          AND NOT EXISTS (SELECT 1 FROM pg_bed_assignments a WHERE a.bed_id = b.id)`,
      [bedIds]
    );
  }

  async putLayout(
    operatorId: string,
    propertyId: string,
    draft: PgLayoutPutInput
  ): Promise<PgRoom[]> {
    if (!this.db.isEnabled()) throw this.unavailable();

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      await this.assertManagedOwnership(operatorId, propertyId, client);
      this.validateDraft(draft);
      await this.validateRoomTypes(client, propertyId, draft);

      const existingRooms = await client.query<{ id: string; room_number: string }>(
        `SELECT id::text, room_number
           FROM pg_rooms
          WHERE pg_property_id = $1::uuid
          FOR UPDATE`,
        [propertyId]
      );
      const roomByNumber = new Map(existingRooms.rows.map((room) => [room.room_number, room]));
      const retainedRoomIds = new Set<string>();

      for (const inputRoom of draft.rooms) {
        const roomNumber = inputRoom.room_number.trim();
        const existingRoom = roomByNumber.get(roomNumber);
        let roomId: string;
        if (existingRoom) {
          roomId = existingRoom.id;
          retainedRoomIds.add(roomId);
          await client.query(
            `UPDATE pg_rooms
                SET room_type_id = $2::uuid, floor = $3, display_label = $4,
                    bed_count = $5, status = 'active'
              WHERE id = $1::uuid`,
            [
              roomId,
              inputRoom.room_type_id ?? null,
              inputRoom.floor ?? null,
              inputRoom.display_label?.trim() || null,
              inputRoom.bed_count
            ]
          );
        } else {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO pg_rooms
               (pg_property_id, room_type_id, floor, room_number, display_label, bed_count, status)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'active')
             RETURNING id::text`,
            [
              propertyId,
              inputRoom.room_type_id ?? null,
              inputRoom.floor ?? null,
              roomNumber,
              inputRoom.display_label?.trim() || null,
              inputRoom.bed_count
            ]
          );
          roomId = inserted.rows[0].id;
          retainedRoomIds.add(roomId);
        }

        const existingBeds = await client.query<{ id: string; bed_label: string }>(
          `SELECT id::text, bed_label FROM pg_beds WHERE room_id = $1::uuid FOR UPDATE`,
          [roomId]
        );
        const bedByLabel = new Map(existingBeds.rows.map((bed) => [bed.bed_label, bed]));
        const retainedBedIds = new Set<string>();
        for (const inputBed of inputRoom.beds) {
          const label = inputBed.bed_label.trim();
          const existingBed = bedByLabel.get(label);
          if (existingBed) {
            retainedBedIds.add(existingBed.id);
            await client.query(
              `UPDATE pg_beds
                  SET status = $2::pg_bed_status, available_from = $3::date,
                      sort_order = $4, metadata = $5::jsonb
                WHERE id = $1::uuid`,
              [
                existingBed.id,
                inputBed.status ?? "vacant",
                inputBed.available_from ?? null,
                inputBed.sort_order ?? null,
                JSON.stringify(inputBed.metadata ?? {})
              ]
            );
          } else {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO pg_beds
                 (room_id, bed_label, status, available_from, sort_order, metadata)
               VALUES ($1::uuid, $2, $3::pg_bed_status, $4::date, $5, $6::jsonb)
               RETURNING id::text`,
              [
                roomId,
                label,
                inputBed.status ?? "vacant",
                inputBed.available_from ?? null,
                inputBed.sort_order ?? null,
                JSON.stringify(inputBed.metadata ?? {})
              ]
            );
            retainedBedIds.add(inserted.rows[0].id);
          }
        }
        await this.retireOrDeleteBeds(
          client,
          existingBeds.rows.filter((bed) => !retainedBedIds.has(bed.id)).map((bed) => bed.id)
        );
      }

      for (const room of existingRooms.rows.filter((row) => !retainedRoomIds.has(row.id))) {
        const beds = await client.query<{ id: string }>(
          `SELECT id::text FROM pg_beds WHERE room_id = $1::uuid FOR UPDATE`,
          [room.id]
        );
        await this.retireOrDeleteBeds(
          client,
          beds.rows.map((bed) => bed.id)
        );
        const history = await client.query<{ has_history: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_beds b
               JOIN pg_bed_assignments a ON a.bed_id = b.id
              WHERE b.room_id = $1::uuid
           ) AS has_history`,
          [room.id]
        );
        if (history.rows[0].has_history) {
          await client.query(
            `UPDATE pg_rooms
                SET status = 'inactive',
                    bed_count = (SELECT count(*)::smallint FROM pg_beds WHERE room_id = $1::uuid)
              WHERE id = $1::uuid`,
            [room.id]
          );
        } else {
          await client.query(`DELETE FROM pg_rooms WHERE id = $1::uuid`, [room.id]);
        }
      }

      await client.query(`UPDATE pg_properties SET layout_status = 'ready' WHERE id = $1::uuid`, [
        propertyId
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return this.getLayout(operatorId, propertyId);
  }
}
