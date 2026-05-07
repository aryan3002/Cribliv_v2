import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface AreaStatsRow {
  bhk: number;
  count: number;
  avg_rent: number;
  min_rent: number;
  max_rent: number;
  verified_count: number;
}

export interface AreaStatsResponse {
  total_pins: number;
  by_bhk: AreaStatsRow[];
  verified_count: number;
  verified_pct: number;
  trend: "up" | "down" | "stable";
}

export interface MetroStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
}

export interface MetroLine {
  line_name: string;
  line_color: string;
  stations: MetroStation[];
}

export interface SeekerPin {
  id: string;
  lat: number;
  lng: number;
  budget_min: number;
  budget_max: number;
  bhk_preference: number[];
  move_in: string;
  listing_type: string;
  note: string | null;
  created_at: string;
}

export interface LocalityInsight {
  locality_name: string;
  summary: string | null;
  stats: {
    active_listings: number;
    avg_rent_2bhk: number | null;
    demand_score: number;
    median_days_active: number | null;
    verified_pct: number;
  };
  trend: "up" | "down" | "stable";
}

export interface AlertZone {
  id: string;
  label: string;
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
  filters: Record<string, unknown>;
  notify_whatsapp: boolean;
  notify_email: boolean;
  is_active: boolean;
  last_triggered: string | null;
  created_at: string;
}

/* ── AI Config ──────────────────────────────────────────────────────── */

function readAiConfig() {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment: process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ?? "",
    // 2s default — if AI takes longer, user gets stats-only instantly
    timeoutMs: Math.max(Number(process.env.AZURE_AI_TIMEOUT_MS) || 2000, 1500)
  };
}

/* ── Service ────────────────────────────────────────────────────────── */

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);
  private metroCache: { lines: MetroLine[]; fetchedAt: number } | null = null;
  private localityCache = new Map<string, { data: LocalityInsight; at: number }>();

  constructor(private readonly database: DatabaseService) {}

  /* ─── Phase 2: Area Stats ───────────────────────────────────────── */

  async getAreaStats(
    sw_lng: number,
    sw_lat: number,
    ne_lng: number,
    ne_lat: number,
    listingType?: string,
    nearMetro?: boolean
  ): Promise<AreaStatsResponse> {
    if (!this.database.isEnabled()) {
      return { total_pins: 0, by_bhk: [], verified_count: 0, verified_pct: 0, trend: "stable" };
    }

    const metroClause = nearMetro
      ? `AND EXISTS (
           SELECT 1 FROM metro_stations ms
           WHERE ms.lat BETWEEN ll.lat::float8 - 0.009 AND ll.lat::float8 + 0.009
             AND ms.lng BETWEEN ll.lng::float8 - 0.009 AND ll.lng::float8 + 0.009
         )`
      : "";

    const bhkResult = await this.database.query<AreaStatsRow>(
      `SELECT
         l.bhk,
         COUNT(*)::int AS count,
         AVG(l.monthly_rent)::int AS avg_rent,
         MIN(l.monthly_rent)::int AS min_rent,
         MAX(l.monthly_rent)::int AS max_rent,
         COUNT(*) FILTER (WHERE l.verification_status = 'verified')::int AS verified_count
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       WHERE l.status = 'active'
         AND ll.lat IS NOT NULL
         AND ll.lat::float8 BETWEEN $1 AND $2
         AND ll.lng::float8 BETWEEN $3 AND $4
         AND ($5::text IS NULL OR l.listing_type::text = $5)
         ${metroClause}
       GROUP BY l.bhk ORDER BY l.bhk`,
      [sw_lat, ne_lat, sw_lng, ne_lng, listingType ?? null]
    );

    const byBhk = bhkResult.rows;
    const totalPins = byBhk.reduce((s, r) => s + r.count, 0);
    const verifiedCount = byBhk.reduce((s, r) => s + r.verified_count, 0);

    // 3-month trend
    let trend: "up" | "down" | "stable" = "stable";
    try {
      const trendResult = await this.database.query<{ recent_avg: number; older_avg: number }>(
        `SELECT
           AVG(CASE WHEN l.created_at >= now() - INTERVAL '90 days' THEN l.monthly_rent END)::int AS recent_avg,
           AVG(CASE WHEN l.created_at >= now() - INTERVAL '180 days' AND l.created_at < now() - INTERVAL '90 days' THEN l.monthly_rent END)::int AS older_avg
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active'
           AND ll.lat IS NOT NULL
           AND ll.lat::float8 BETWEEN $1 AND $2
           AND ll.lng::float8 BETWEEN $3 AND $4`,
        [sw_lat, ne_lat, sw_lng, ne_lng]
      );
      const r = trendResult.rows[0];
      if (r?.recent_avg && r?.older_avg) {
        const diff = (r.recent_avg - r.older_avg) / r.older_avg;
        trend = diff > 0.05 ? "up" : diff < -0.05 ? "down" : "stable";
      }
    } catch {
      /* trend is optional */
    }

    return {
      total_pins: totalPins,
      by_bhk: byBhk,
      verified_count: verifiedCount,
      verified_pct: totalPins > 0 ? Math.round((verifiedCount / totalPins) * 100) : 0,
      trend
    };
  }

  /* ─── Phase 2: Metro Data ───────────────────────────────────────── */

  async getMetroStations(city: string): Promise<{ lines: MetroLine[] }> {
    if (this.metroCache && Date.now() - this.metroCache.fetchedAt < 3600_000) {
      return { lines: this.metroCache.lines };
    }

    if (!this.database.isEnabled()) {
      return { lines: [] };
    }

    const result = await this.database.query<{
      id: number;
      line_name: string;
      line_color: string;
      station_name: string;
      lat: number;
      lng: number;
      sequence: number;
    }>(
      `SELECT id, line_name, line_color, station_name, lat, lng, sequence
       FROM metro_stations
       WHERE city = $1
       ORDER BY line_name, sequence`,
      [city]
    );

    const lineMap = new Map<string, MetroLine>();
    for (const row of result.rows) {
      let line = lineMap.get(row.line_name);
      if (!line) {
        line = { line_name: row.line_name, line_color: row.line_color, stations: [] };
        lineMap.set(row.line_name, line);
      }
      line.stations.push({
        id: row.id,
        name: row.station_name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        sequence: row.sequence
      });
    }

    const lines = Array.from(lineMap.values());
    this.metroCache = { lines, fetchedAt: Date.now() };
    return { lines };
  }

  /* ─── Phase 3: Seeker Pins ──────────────────────────────────────── */

  async getSeekerPins(
    sw_lat: number,
    sw_lng: number,
    ne_lat: number,
    ne_lng: number
  ): Promise<SeekerPin[]> {
    if (!this.database.isEnabled()) return [];

    const result = await this.database.query<SeekerPin>(
      `SELECT
         id::text,
         lat,
         lng,
         budget_min,
         budget_max,
         bhk_preference,
         move_in,
         listing_type,
         note,
         created_at::text
       FROM seeker_pins
       WHERE is_active = true
         AND expires_at > now()
         AND lat BETWEEN $1 AND $2
         AND lng BETWEEN $3 AND $4
       ORDER BY created_at DESC
       LIMIT 200`,
      [sw_lat, ne_lat, sw_lng, ne_lng]
    );

    return result.rows.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
  }

  async createSeekerPin(
    userId: string,
    lat: number,
    lng: number,
    data: {
      city?: string;
      budget_min?: number;
      budget_max: number;
      bhk_preference?: number[];
      move_in?: string;
      listing_type?: string;
      note?: string;
    }
  ): Promise<{ id: string }> {
    if (!this.database.isEnabled()) throw new Error("Database not available");

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO seeker_pins (user_id, lat, lng, city, budget_min, budget_max, bhk_preference, move_in, listing_type, note)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::smallint[], $8, $9, $10)
       RETURNING id::text`,
      [
        userId,
        lat,
        lng,
        data.city ?? "delhi",
        data.budget_min ?? 0,
        data.budget_max,
        data.bhk_preference ?? [],
        data.move_in ?? "flexible",
        data.listing_type ?? "flat_house",
        data.note?.slice(0, 200) ?? null
      ]
    );

    return result.rows[0];
  }

  async deleteSeekerPin(userId: string, pinId: string): Promise<boolean> {
    if (!this.database.isEnabled()) return false;

    const result = await this.database.query(
      `UPDATE seeker_pins SET is_active = false WHERE id = $1::uuid AND user_id = $2::uuid AND is_active = true`,
      [pinId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async seekersNearListing(
    listingId: string
  ): Promise<{ count: number; avg_budget: number | null }> {
    if (!this.database.isEnabled()) return { count: 0, avg_budget: null };

    // Rectangular bounding box approximation for ~2km radius at Delhi latitudes:
    // 0.018° lat ≈ 2km, 0.022° lng ≈ 2km
    const result = await this.database.query<{ count: number; avg_budget: number | null }>(
      `SELECT
         COUNT(*)::int AS count,
         AVG(sp.budget_max)::int AS avg_budget
       FROM seeker_pins sp
       JOIN listing_locations ll ON ll.listing_id = $1::uuid
       WHERE sp.is_active = true
         AND sp.expires_at > now()
         AND ll.lat IS NOT NULL
         AND sp.lat BETWEEN ll.lat::float8 - 0.018 AND ll.lat::float8 + 0.018
         AND sp.lng BETWEEN ll.lng::float8 - 0.022 AND ll.lng::float8 + 0.022`,
      [listingId]
    );

    return result.rows[0] ?? { count: 0, avg_budget: null };
  }

  /* ─── Phase 4: Locality Insight ─────────────────────────────────── */

  async getLocalityInsight(
    lat: number,
    lng: number,
    city: string,
    locale: string = "en"
  ): Promise<LocalityInsight> {
    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}_${locale}`;
    const cached = this.localityCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 3600_000) {
      return cached.data;
    }

    if (!this.database.isEnabled()) {
      return {
        locality_name: "Unknown",
        summary: null,
        stats: {
          active_listings: 0,
          avg_rent_2bhk: null,
          demand_score: 0,
          median_days_active: null,
          verified_pct: 0
        },
        trend: "stable"
      };
    }

    // Find nearest locality by simple Euclidean distance on lat/lng
    const localityResult = await this.database.query<{ locality_name: string }>(
      `SELECT name_en AS locality_name
       FROM localities
       WHERE city_id IN (SELECT id FROM cities WHERE slug = $1)
       ORDER BY ((lat::float8 - $2)^2 + (lng::float8 - $3)^2)
       LIMIT 1`,
      [city, lat, lng]
    );
    const localityName = localityResult.rows[0]?.locality_name ?? "This Area";

    // Stats within ~2km bounding box (0.018° lat, 0.022° lng)
    const statsResult = await this.database.query<{
      active_listings: number;
      avg_rent_2bhk: number | null;
      verified_pct: number;
      median_days: number | null;
    }>(
      `SELECT
         COUNT(*)::int AS active_listings,
         AVG(l.monthly_rent) FILTER (WHERE l.bhk = 2)::int AS avg_rent_2bhk,
         CASE WHEN COUNT(*) > 0 THEN
           (COUNT(*) FILTER (WHERE l.verification_status = 'verified')::float / COUNT(*) * 100)::int
         ELSE 0 END AS verified_pct,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(DAY FROM now() - l.created_at))::int AS median_days
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       WHERE l.status = 'active'
         AND ll.lat IS NOT NULL
         AND ll.lat::float8 BETWEEN $1 - 0.018 AND $1 + 0.018
         AND ll.lng::float8 BETWEEN $2 - 0.022 AND $2 + 0.022`,
      [lat, lng]
    );
    const stats = statsResult.rows[0];

    // Seeker density in the same bounding box
    let seekerDensity = 0;
    try {
      const seekerResult = await this.database.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM seeker_pins
         WHERE is_active = true AND expires_at > now()
           AND lat BETWEEN $1 - 0.018 AND $1 + 0.018
           AND lng BETWEEN $2 - 0.022 AND $2 + 0.022`,
        [lat, lng]
      );
      seekerDensity = seekerResult.rows[0]?.count ?? 0;
    } catch {
      /* seeker table may not exist yet */
    }

    const activeListings = stats?.active_listings ?? 0;
    const demandScore = Math.min(
      100,
      Math.round(
        (seekerDensity * 4 +
          Math.min(activeListings, 50) * 0.7 +
          (stats?.median_days ? Math.max(0, 30 - stats.median_days) : 0) * 0.5) *
          1.5
      )
    );

    // Trend (listing velocity)
    let trend: "up" | "down" | "stable" = "stable";
    try {
      const trendResult = await this.database.query<{ recent: number; older: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE l.created_at >= now() - INTERVAL '30 days')::int AS recent,
           COUNT(*) FILTER (WHERE l.created_at >= now() - INTERVAL '60 days' AND l.created_at < now() - INTERVAL '30 days')::int AS older
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active'
           AND ll.lat IS NOT NULL
           AND ll.lat::float8 BETWEEN $1 - 0.018 AND $1 + 0.018
           AND ll.lng::float8 BETWEEN $2 - 0.022 AND $2 + 0.022`,
        [lat, lng]
      );
      const t = trendResult.rows[0];
      if (t && t.older > 0) {
        const change = (t.recent - t.older) / t.older;
        trend = change > 0.15 ? "up" : change < -0.15 ? "down" : "stable";
      }
    } catch {
      /* optional */
    }

    // AI summary
    let summary: string | null = null;
    try {
      summary = await this.generateLocalitySummary(
        localityName,
        {
          activeListings,
          avgRent2bhk: stats?.avg_rent_2bhk ?? null,
          verifiedPct: stats?.verified_pct ?? 0,
          demandScore,
          seekerCount: seekerDensity,
          trend
        },
        locale
      );
    } catch (err) {
      this.logger.warn(`AI summary failed for ${localityName}: ${err}`);
    }

    const insight: LocalityInsight = {
      locality_name: localityName,
      summary,
      stats: {
        active_listings: activeListings,
        avg_rent_2bhk: stats?.avg_rent_2bhk ?? null,
        demand_score: demandScore,
        median_days_active: stats?.median_days ?? null,
        verified_pct: stats?.verified_pct ?? 0
      },
      trend
    };

    this.localityCache.set(cacheKey, { data: insight, at: Date.now() });
    return insight;
  }

  private async generateLocalitySummary(
    locality: string,
    data: {
      activeListings: number;
      avgRent2bhk: number | null;
      verifiedPct: number;
      demandScore: number;
      seekerCount: number;
      trend: string;
    },
    locale: string
  ): Promise<string | null> {
    const config = readAiConfig();
    if (!config.endpoint || !config.apiKey || !config.deployment) return null;

    const lang = locale === "hi" ? "Hindi (Devanagari script)" : "English";
    const prompt = `You are a real estate market analyst for Indian cities.
Summarize this locality in 2-3 sentences in ${lang}:
- Locality: ${locality}
- Active listings: ${data.activeListings}
- Average 2BHK rent: ${data.avgRent2bhk ? `₹${data.avgRent2bhk.toLocaleString("en-IN")}` : "N/A"}
- Verified listings: ${data.verifiedPct}%
- Demand score: ${data.demandScore}/100
- Active seekers nearby: ${data.seekerCount}
- Rent trend: ${data.trend}

Focus on what a renter would want to know: affordability, demand, verification quality. Be concise and data-driven.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": config.apiKey },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a concise real estate market analyst." },
            { role: "user", content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 200
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      if (!response.ok || !payload.choices?.[0]?.message?.content) return null;
      return payload.choices[0].message.content.trim().slice(0, 500);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ─── Phase 5: Alert Zones ──────────────────────────────────────── */

  async getAlertZones(userId: string): Promise<AlertZone[]> {
    if (!this.database.isEnabled()) return [];

    const result = await this.database.query<AlertZone>(
      `SELECT
         id::text,
         label,
         sw_lat,
         sw_lng,
         ne_lat,
         ne_lng,
         filters,
         notify_whatsapp,
         notify_email,
         is_active,
         last_triggered::text,
         created_at::text
       FROM alert_zones
       WHERE user_id = $1::uuid AND is_active = true
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map((r) => ({
      ...r,
      sw_lat: Number(r.sw_lat),
      sw_lng: Number(r.sw_lng),
      ne_lat: Number(r.ne_lat),
      ne_lng: Number(r.ne_lng)
    }));
  }

  async createAlertZone(
    userId: string,
    data: {
      sw_lat: number;
      sw_lng: number;
      ne_lat: number;
      ne_lng: number;
      label?: string;
      filters?: Record<string, unknown>;
      notify_whatsapp?: boolean;
      notify_email?: boolean;
    }
  ): Promise<{ id: string }> {
    if (!this.database.isEnabled()) throw new Error("Database not available");

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO alert_zones (user_id, sw_lat, sw_lng, ne_lat, ne_lng, label, filters, notify_whatsapp, notify_email)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING id::text`,
      [
        userId,
        data.sw_lat,
        data.sw_lng,
        data.ne_lat,
        data.ne_lng,
        data.label ?? "My Alert Zone",
        JSON.stringify(data.filters ?? {}),
        data.notify_whatsapp ?? true,
        data.notify_email ?? false
      ]
    );

    return result.rows[0];
  }

  async deleteAlertZone(userId: string, zoneId: string): Promise<boolean> {
    if (!this.database.isEnabled()) return false;

    const result = await this.database.query(
      `UPDATE alert_zones SET is_active = false WHERE id = $1::uuid AND user_id = $2::uuid AND is_active = true`,
      [zoneId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }
}
