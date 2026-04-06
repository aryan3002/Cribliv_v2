import { Inject, Injectable, Logger, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

const BOOST_PLANS: Record<string, { duration_hours: number; amount_paise: number; label: string }> =
  {
    featured_7d: { duration_hours: 7 * 24, amount_paise: 29900, label: "Featured 7 days" },
    featured_15d: { duration_hours: 15 * 24, amount_paise: 49900, label: "Featured 15 days" },
    featured_30d: { duration_hours: 30 * 24, amount_paise: 79900, label: "Featured 30 days" },
    boost_48h: { duration_hours: 48, amount_paise: 9900, label: "Boost 48 hours" },
    boost_72h: { duration_hours: 72, amount_paise: 14900, label: "Boost 72 hours" }
  };

@Injectable()
export class BoostService {
  private readonly logger = new Logger(BoostService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  getPlans() {
    return Object.entries(BOOST_PLANS).map(([key, plan]) => ({
      plan_id: key,
      boost_type: key.startsWith("featured") ? "featured" : "boost",
      duration_hours: plan.duration_hours,
      amount_paise: plan.amount_paise,
      label: plan.label
    }));
  }

  async createBoostOrder(
    ownerUserId: string,
    listingId: string,
    planId: string
  ): Promise<{
    order_id: string;
    amount_paise: number;
    boost_type: string;
    plan_label: string;
  }> {
    const flags = readFeatureFlags();
    if (!flags.ff_featured_listings_enabled) {
      throw new BadRequestException({
        code: "feature_disabled",
        message: "Featured listings not enabled"
      });
    }

    const plan = BOOST_PLANS[planId];
    if (!plan) {
      throw new BadRequestException({ code: "invalid_plan", message: "Invalid boost plan" });
    }

    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    // Verify listing belongs to owner
    const listing = await this.database.query<{ id: string }>(
      `SELECT id::text FROM listings WHERE id = $1::uuid AND owner_user_id = $2::uuid AND status = 'active' LIMIT 1`,
      [listingId, ownerUserId]
    );
    if (!listing.rows.length) {
      throw new BadRequestException({ code: "not_found", message: "Active listing not found" });
    }

    const boostType = planId.startsWith("featured") ? "featured" : "boost";

    // Create payment order
    const order = await this.database.query<{ id: string }>(
      `INSERT INTO payment_orders (user_id, provider, amount_paise, credits_to_grant, status, metadata)
       VALUES ($1::uuid, 'razorpay', $2, 0, 'created', $3::jsonb)
       RETURNING id::text`,
      [
        ownerUserId,
        plan.amount_paise,
        JSON.stringify({ listing_id: listingId, plan_id: planId, boost_type: boostType })
      ]
    );

    return {
      order_id: order.rows[0].id,
      amount_paise: plan.amount_paise,
      boost_type: boostType,
      plan_label: plan.label
    };
  }

  /**
   * Activate a boost after payment capture. Called from payment webhook.
   */
  async activateBoost(
    orderId: string,
    listingId: string,
    ownerUserId: string,
    boostType: "featured" | "boost",
    durationHours: number
  ): Promise<{ boost_id: string }> {
    if (!this.database.isEnabled()) return { boost_id: "" };

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO listing_boosts (listing_id, owner_user_id, boost_type, payment_order_id, starts_at, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::boost_type, $4::uuid, now(), now() + make_interval(hours => $5))
       RETURNING id::text`,
      [listingId, ownerUserId, boostType, orderId, durationHours]
    );

    return { boost_id: result.rows[0]?.id ?? "" };
  }

  async getActiveBoost(listingId: string): Promise<{
    has_boost: boolean;
    boost_type?: string;
    expires_at?: string;
  }> {
    if (!this.database.isEnabled()) return { has_boost: false };

    const result = await this.database.query<{ boost_type: string; expires_at: string }>(
      `SELECT boost_type::text, expires_at::text
       FROM listing_boosts
       WHERE listing_id = $1::uuid AND is_active = true AND expires_at > now()
       ORDER BY expires_at DESC
       LIMIT 1`,
      [listingId]
    );

    if (!result.rows.length) return { has_boost: false };
    return {
      has_boost: true,
      boost_type: result.rows[0].boost_type,
      expires_at: result.rows[0].expires_at
    };
  }

  /**
   * Worker: expire all boosts past their expiry time.
   */
  async expireBoosts(): Promise<number> {
    if (!this.database.isEnabled()) return 0;

    const result = await this.database.query(
      `UPDATE listing_boosts SET is_active = false, updated_at = now()
       WHERE is_active = true AND expires_at <= now()`
    );

    return result.rowCount ?? 0;
  }
}
