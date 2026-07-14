import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";
import { AppStateService } from "../src/common/app-state.service";
import { DatabaseService } from "../src/common/database.service";
import { NotificationService } from "../src/modules/notifications/notification.service";
import { AdminAnalyticsService } from "../src/modules/admin/admin-analytics.service";
import { AdminOpsService } from "../src/modules/admin/admin-ops.service";
import { AdminOwnerHealthService } from "../src/modules/admin/admin-owner-health.service";
import { AdminRevenueService } from "../src/modules/admin/admin-revenue.service";
import { AdminFraudFeedService } from "../src/modules/admin/admin-fraud-feed.service";
import { AdminRentAgreementService } from "../src/modules/admin/admin-rent-agreement.service";
import { PgScoreService } from "../src/modules/pg-operator/services/pg-score.service";
import { PgFunnelService } from "../src/modules/pg-operator/services/pg-funnel.service";
import { PgAdminAnalyticsService } from "../src/modules/admin/pg-admin-analytics.service";
import { PgAdminPropertiesService } from "../src/modules/admin/pg-admin-properties.service";
import { PgAnalyticsOverrideService } from "../src/modules/admin/pg-analytics-override.service";
import { PgAdminListingEditService } from "../src/modules/admin/pg-admin-listing-edit.service";
import { AdminReviewService } from "../src/modules/admin/admin-review.service";
import { AdminController } from "../src/modules/admin/admin.controller";
import { IndexingService } from "../src/modules/seo/indexing.service";
import { listingIndexPaths } from "../src/modules/seo/seo-urls";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const LISTING_ID = "00000000-0000-4000-8000-0000000000aa";

describe("AdminController.listingDecision - seo.queue_indexing enqueue on approve", () => {
  let app: INestApplication;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let indexing: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    indexing = { enqueue: vi.fn(async () => null) };
    database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        if (/SELECT l\.listing_type/.test(sql)) {
          return { rows: [{ listing_type: "flat_house", photo_count: 6 }], rowCount: 1 };
        }
        if (/UPDATE listings/.test(sql)) {
          return { rows: [{ id: LISTING_ID, status: "active" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      })
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        RolesGuard,
        { provide: AppStateService, useValue: new AppStateService() },
        { provide: DatabaseService, useValue: database },
        { provide: NotificationService, useValue: { send: vi.fn() } },
        { provide: AdminAnalyticsService, useValue: {} },
        { provide: AdminOpsService, useValue: {} },
        { provide: AdminOwnerHealthService, useValue: {} },
        { provide: AdminRevenueService, useValue: {} },
        { provide: AdminFraudFeedService, useValue: {} },
        { provide: AdminRentAgreementService, useValue: {} },
        { provide: PgScoreService, useValue: { rescoreListing: vi.fn() } },
        { provide: PgFunnelService, useValue: { trackPublished: vi.fn() } },
        { provide: PgAdminAnalyticsService, useValue: {} },
        { provide: PgAdminPropertiesService, useValue: {} },
        { provide: PgAnalyticsOverrideService, useValue: {} },
        { provide: PgAdminListingEditService, useValue: {} },
        { provide: IndexingService, useValue: indexing },
        { provide: AdminReviewService, useValue: {} }
      ]
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = { id: ADMIN_ID, role: "admin" };
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("inserts a seo.queue_indexing outbound_events row when a listing is approved", async () => {
    await request(app.getHttpServer())
      .post(`/admin/review/listings/${LISTING_ID}/decision`)
      .send({ decision: "approve" })
      .expect(201);

    const enqueueCall = database.query.mock.calls.find(
      ([sql]: [string]) =>
        sql.includes("INSERT INTO outbound_events") && sql.includes("seo.queue_indexing")
    );
    expect(enqueueCall).toBeDefined();
    const [sql, params] = enqueueCall!;
    expect(sql).toContain("'seo.queue_indexing'");
    expect(sql).toContain("'listing'");
    expect(params[0]).toBe(LISTING_ID);
    const payload = JSON.parse(params[1]);
    expect(payload).toEqual({ listing_id: LISTING_ID, reason: "listing_approved" });

    // ...and actually queues the listing's canonical page(s) for the Indexing
    // API (flat_house -> /{locale}/listing/{id} in both locales).
    const expectedPaths = listingIndexPaths("flat_house", undefined, LISTING_ID);
    expect(indexing.enqueue).toHaveBeenCalledTimes(expectedPaths.length);
    for (const path of expectedPaths) {
      expect(indexing.enqueue).toHaveBeenCalledWith(path, "listing_approved");
    }
  });

  it("does NOT enqueue on reject", async () => {
    await request(app.getHttpServer())
      .post(`/admin/review/listings/${LISTING_ID}/decision`)
      .send({ decision: "reject", reason: "spam" })
      .expect(201);

    const enqueueCall = database.query.mock.calls.find(([sql]: [string]) =>
      sql.includes("seo.queue_indexing")
    );
    expect(enqueueCall).toBeUndefined();
    expect(indexing.enqueue).not.toHaveBeenCalled();
  });
});
