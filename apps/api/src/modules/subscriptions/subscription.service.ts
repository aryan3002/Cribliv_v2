import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

@Injectable()
export class SubscriptionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getPlans(): Promise<
    {
      plan_id: string;
      label: string;
      amount_paise: number;
      duration_days: number;
      max_featured_slots: number;
    }[]
  > {
    if (!this.database.isEnabled()) {
      return [];
    }

    const result = await this.database.query<{
      plan_id: string;
      label: string;
      amount_paise: number;
      duration_days: number;
      max_featured_slots: number;
    }>(
      `SELECT plan_id, label, amount_paise, duration_days, max_featured_slots
       FROM subscription_plans
       WHERE is_active = true
       ORDER BY amount_paise ASC`
    );

    return result.rows;
  }

  async createSubscriptionOrder(
    ownerUserId: string,
    planId: string
  ): Promise<{ order_id: string; amount_paise: number; plan_label: string }> {
    const flags = readFeatureFlags();
    if (!flags.ff_subscription_plans_enabled) {
      throw new BadRequestException({
        code: "feature_disabled",
        message: "Subscription plans not enabled"
      });
    }
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const plan = await this.database.query<{
      plan_id: string;
      label: string;
      amount_paise: number;
    }>(
      `SELECT plan_id, label, amount_paise
       FROM subscription_plans
       WHERE plan_id = $1 AND is_active = true
       LIMIT 1`,
      [planId]
    );

    if (!plan.rows.length) {
      throw new BadRequestException({ code: "invalid_plan", message: "Invalid subscription plan" });
    }

    const { label, amount_paise } = plan.rows[0];

    const order = await this.database.query<{ id: string }>(
      `INSERT INTO payment_orders (user_id, provider, amount_paise, credits_to_grant, status, metadata)
       VALUES ($1::uuid, 'razorpay', $2, 0, 'created', $3::jsonb)
       RETURNING id::text`,
      [ownerUserId, amount_paise, JSON.stringify({ subscription_plan_id: planId })]
    );

    return {
      order_id: order.rows[0].id,
      amount_paise,
      plan_label: label
    };
  }

  async getActiveSubscription(ownerUserId: string): Promise<{
    has_subscription: boolean;
    plan_id?: string;
    plan_label?: string;
    max_featured_slots?: number;
    expires_at?: string;
    auto_renew?: boolean;
  }> {
    if (!this.database.isEnabled()) return { has_subscription: false };

    const result = await this.database.query<{
      subscription_id: string;
      plan_id: string;
      plan_label: string;
      max_featured_slots: number;
      expires_at: string;
      auto_renew: boolean;
    }>(
      `SELECT
         os.id::text          AS subscription_id,
         os.plan_id,
         sp.label             AS plan_label,
         sp.max_featured_slots,
         os.expires_at::text,
         os.auto_renew
       FROM owner_subscriptions os
       JOIN subscription_plans sp ON sp.plan_id = os.plan_id
       WHERE os.owner_user_id = $1::uuid
         AND os.status = 'active'
         AND os.expires_at > now()
       ORDER BY os.expires_at DESC
       LIMIT 1`,
      [ownerUserId]
    );

    if (!result.rows.length) return { has_subscription: false };

    const row = result.rows[0];
    return {
      has_subscription: true,
      plan_id: row.plan_id,
      plan_label: row.plan_label,
      max_featured_slots: row.max_featured_slots,
      expires_at: row.expires_at,
      auto_renew: row.auto_renew
    };
  }
}
