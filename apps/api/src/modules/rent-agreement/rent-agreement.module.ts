import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { DatabaseService } from "../../common/database.service";

import { DraftsService } from "./drafts/drafts.service";
import { SignaturesService } from "./signatures/signatures.service";
import { CheckoutService } from "./checkout/checkout.service";
import { DownloadsService } from "./downloads/downloads.service";
import { StampDutyService } from "./stamp-duty/stamp-duty.service";
import { StampDutyRepository } from "./stamp-duty/stamp-duty.repository";

import { MockPaymentProvider } from "./payments/mock-payment-provider";
import { RazorpayPaymentProvider } from "./payments/razorpay-payment-provider";
import type { RentAgreementPaymentProviderPort } from "./payments/payment-provider.port";
import { DevAutoCapturePipeline } from "./payments/dev-auto-capture-pipeline";

import { PdfJobQueueService } from "./pdf/pdf-job-queue.service";
import { PdfJobWorker } from "./pdf/pdf-job-worker";
import { LazyPuppeteerPdfRenderer } from "./pdf/lazy-puppeteer-renderer";
import { InMemoryPdfStorage } from "./pdf/in-memory-pdf-storage";
import type { PdfRendererPort } from "./pdf/pdf-renderer.port";
import type { PdfStoragePort } from "./pdf/pdf-storage.port";
import { PdfPreviewService } from "./pdf/pdf-preview.service";

import { DevApiSasIssuer } from "./downloads/dev-api-sas-issuer";
import {
  makeDraftsAgreementLoader,
  makeDraftsCounterIncrementer,
  makeNoopAuditRecorder
} from "./downloads/drafts-downloads-bridge";

import { getPlanAmountPaise } from "./plans/plans.catalog";
import { RentAgreementController } from "./rent-agreement.controller";

import { EStampingController } from "./e-stamping/e-stamping.controller";
import { EStampingService } from "./e-stamping/e-stamping.service";
import { MockEStampingProvider } from "./e-stamping/mock-e-stamping.provider";
import type { EStampingProvider } from "./e-stamping/e-stamping.adapter";

import { ESignController } from "./e-sign/e-sign.controller";
import { ESignService } from "./e-sign/e-sign.service";
import { MockESignProvider } from "./e-sign/mock-e-sign.provider";
import type { ESignProvider } from "./e-sign/e-sign.adapter";

// ─── Phase A: DB persistence wiring ──────────────────────────────────────────
import { DbDraftsRepository, InMemoryDraftsRepository } from "./drafts/drafts.repository";
import {
  DbSignaturesRepository,
  InMemorySignaturesRepository
} from "./signatures/signatures.repository";
import { DbPdfJobRepository, InMemoryPdfJobRepository } from "./pdf/pdf-job.repository";
import {
  DbPaymentOrdersRepository,
  InMemoryPaymentOrdersRepository
} from "./checkout/payment-orders.repository";
import { AzurePdfStorage } from "./pdf/azure-pdf-storage";
import { buildAzureConnectionString, readAzureStorageConfig } from "./pdf/azure-storage-config";
import { AzureSasIssuer } from "./downloads/azure-sas-issuer";
import { makeDbDownloadAuditRecorder } from "./downloads/db-download-audit";
import type { SasIssuerPort } from "./downloads/sas-issuer.port";
import { RentAgreementDbAnalyticsService } from "./analytics/rent-agreement-db-analytics.service";
import { nullAnalytics, type RentAgreementAnalyticsPort } from "./plans/null-analytics";

// ─── Phase 13 wiring ─────────────────────────────────────────────────────────
// Dev mode (default): MockPaymentProvider + DevAutoCapturePipeline + InMemoryPdfRenderer
//                     + InMemoryPdfStorage + DevApiSasIssuer. Whole flow runs locally.
// Production mode  : Swap providers via DI per PRODUCTION-WIRING.md. NEVER ship
//                     dev wiring to prod — MockPaymentProvider auto-captures every
//                     order without taking real money.
//
// Toggle: NODE_ENV !== 'production' OR RENT_AGREEMENT_DEV_AUTOCAPTURE === 'true'.

export const RENT_AGREEMENT_PAYMENT_PROVIDER = "RENT_AGREEMENT_PAYMENT_PROVIDER";
export const RENT_AGREEMENT_PDF_RENDERER = "RENT_AGREEMENT_PDF_RENDERER";
export const RENT_AGREEMENT_PDF_STORAGE = "RENT_AGREEMENT_PDF_STORAGE";
export const RENT_AGREEMENT_ESTAMP_PROVIDER = "RENT_AGREEMENT_ESTAMP_PROVIDER";
export const RENT_AGREEMENT_ESIGN_PROVIDER = "RENT_AGREEMENT_ESIGN_PROVIDER";
export const RENT_AGREEMENT_SAS_ISSUER = "RENT_AGREEMENT_SAS_ISSUER";
export const RENT_AGREEMENT_ANALYTICS_TOKEN = "RENT_AGREEMENT_ANALYTICS";

function isDevMode(): boolean {
  if (process.env.RENT_AGREEMENT_DEV_AUTOCAPTURE === "true") return true;
  if (process.env.RENT_AGREEMENT_DEV_AUTOCAPTURE === "false") return false;
  return process.env.NODE_ENV !== "production";
}

// 90 days from generation per [[PDF-Pipeline]] §Download window
const DOWNLOAD_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [RentAgreementController, EStampingController, ESignController],
  providers: [
    // ─── Drafts + signatures (DB-backed when DATABASE_URL is set) ────────────
    {
      provide: DraftsService,
      useFactory: (db: DatabaseService) =>
        new DraftsService({
          repository: db.isEnabled() ? new DbDraftsRepository(db) : new InMemoryDraftsRepository()
        }),
      inject: [DatabaseService]
    },
    {
      provide: SignaturesService,
      useFactory: (db: DatabaseService) =>
        new SignaturesService({
          repository: db.isEnabled()
            ? new DbSignaturesRepository(db)
            : new InMemorySignaturesRepository()
        }),
      inject: [DatabaseService]
    },

    // ─── Analytics (DB event log + step audit; no-op when DB disabled) ──────
    {
      provide: RENT_AGREEMENT_ANALYTICS_TOKEN,
      useFactory: (db: DatabaseService): RentAgreementAnalyticsPort =>
        db.isEnabled() ? new RentAgreementDbAnalyticsService(db) : nullAnalytics,
      inject: [DatabaseService]
    },

    // ─── Stamp duty ─────────────────────────────────────────────────────────
    {
      provide: StampDutyRepository,
      useFactory: (db: DatabaseService) => new StampDutyRepository(db),
      inject: [DatabaseService]
    },
    {
      provide: StampDutyService,
      useFactory: (repo: StampDutyRepository) => new StampDutyService(repo),
      inject: [StampDutyRepository]
    },

    // ─── Payment provider (dev: Mock; prod: Razorpay stub until creds wired) ───
    {
      provide: RENT_AGREEMENT_PAYMENT_PROVIDER,
      useFactory: (): RentAgreementPaymentProviderPort =>
        isDevMode() ? new MockPaymentProvider() : new RazorpayPaymentProvider()
    },

    // ─── PDF queue + renderer + storage ─────────────────────────────────────
    {
      provide: PdfJobQueueService,
      useFactory: (db: DatabaseService) =>
        new PdfJobQueueService({
          repository: db.isEnabled() ? new DbPdfJobRepository(db) : new InMemoryPdfJobRepository()
        }),
      inject: [DatabaseService]
    },
    {
      provide: RENT_AGREEMENT_PDF_RENDERER,
      // Real Puppeteer + Handlebars renderer (lazy: Chromium launches on first
      // render). Produces a genuine PDF so /_dev/pdf-bytes serves a real file.
      useFactory: (): PdfRendererPort => new LazyPuppeteerPdfRenderer()
    },
    {
      // Azure Blob when storage creds are present in .env; in-memory otherwise.
      provide: RENT_AGREEMENT_PDF_STORAGE,
      useFactory: (): PdfStoragePort => {
        const azure = readAzureStorageConfig();
        return azure.present
          ? new AzurePdfStorage({
              connectionString: buildAzureConnectionString(azure.accountName, azure.accountKey),
              containerName: azure.containerName
            })
          : new InMemoryPdfStorage();
      }
    },
    {
      // Azure SAS issuer when storage creds are present; dev API issuer otherwise.
      // Exported so AdminModule can issue admin PDF download links.
      provide: RENT_AGREEMENT_SAS_ISSUER,
      useFactory: (): SasIssuerPort => {
        const azure = readAzureStorageConfig();
        return azure.present
          ? new AzureSasIssuer({
              accountName: azure.accountName,
              accountKey: azure.accountKey,
              containerName: azure.containerName
            })
          : new DevApiSasIssuer({ baseUrl: process.env.RENT_AGREEMENT_DEV_BASE_URL ?? "" });
      }
    },

    // ─── PDF worker (single-shot tick — registered in worker.ts for prod) ───
    {
      provide: PdfJobWorker,
      useFactory: (
        queue: PdfJobQueueService,
        renderer: PdfRendererPort,
        storage: PdfStoragePort,
        drafts: DraftsService,
        signatures: SignaturesService
      ) =>
        new PdfJobWorker({
          queue,
          renderer,
          storage,
          loadAgreementForRender: async (agreementId) => {
            const row = await drafts.getRowByIdForRender(agreementId);
            if (!row) return null;
            return { row, signatures: await signatures.listForAgreement(agreementId) };
          },
          onAgreementGenerated: async ({ agreementId, blobPath }) => {
            const expiresAt = new Date(Date.now() + DOWNLOAD_WINDOW_MS).toISOString();
            await drafts.markGenerated(agreementId, { blobPath, expiresAt });
          }
        }),
      inject: [
        PdfJobQueueService,
        RENT_AGREEMENT_PDF_RENDERER,
        RENT_AGREEMENT_PDF_STORAGE,
        DraftsService,
        SignaturesService
      ]
    },

    // ─── Dev auto-capture pipeline ──────────────────────────────────────────
    {
      provide: DevAutoCapturePipeline,
      useFactory: (drafts: DraftsService, queue: PdfJobQueueService, worker: PdfJobWorker) =>
        new DevAutoCapturePipeline({ drafts, queue, worker }),
      inject: [DraftsService, PdfJobQueueService, PdfJobWorker]
    },

    // ─── Checkout (auto-fires capture in dev when MockPaymentProvider) ──────
    {
      provide: CheckoutService,
      useFactory: (
        drafts: DraftsService,
        signatures: SignaturesService,
        paymentProvider: RentAgreementPaymentProviderPort,
        autoCapture: DevAutoCapturePipeline,
        db: DatabaseService,
        analytics: RentAgreementAnalyticsPort
      ) =>
        new CheckoutService({
          repository: db.isEnabled()
            ? new DbPaymentOrdersRepository(db)
            : new InMemoryPaymentOrdersRepository(),
          draftsService: {
            getOne: async (uid: string, did: string) => {
              const full = await drafts.getOne(uid, did);
              if (!full) return null;
              return {
                id: full.id,
                user_id: uid,
                plan_id: full.plan_id,
                state_code: full.state_code,
                locale: full.locale,
                current_step: full.current_step,
                status: full.status,
                stamp_duty_paise: full.stamp_duty_paise
              };
            }
          },
          signaturesService: {
            hasBothSignatures: (id: string) => signatures.hasBothSignatures(id)
          },
          planLookup: getPlanAmountPaise,
          paymentProvider,
          onOrderCreated: async (draftId, providerOrderId, orderId) => {
            // Link the agreement to its payment order by uuid (FK ->
            // rent_agreement_payment_orders.id, migration 0030).
            await drafts.markPendingPayment(draftId, orderId);
            void analytics
              .emit("ra.payment_initiated", {
                agreement_id: draftId,
                provider_order_id: providerOrderId
              })
              .catch(() => {});
            if (isDevMode()) {
              // Fire-and-forget — pipeline awaits markPaid + enqueue, then schedules
              // the worker tick via setImmediate. The HTTP response returns first.
              autoCapture.trigger(draftId).catch(() => {
                // intentional: failures appear in queue.markFailed
              });
            }
          },
          // Dev: settle the persisted order with a mock provider_payment_id so the
          // rent_agreement_payment_orders row is production-complete. Absent in
          // prod — the real payment webhook settles the order there.
          devMockCapture: isDevMode() ? (orderId: string) => `mock_pay_${orderId}` : undefined
        }),
      inject: [
        DraftsService,
        SignaturesService,
        RENT_AGREEMENT_PAYMENT_PROVIDER,
        DevAutoCapturePipeline,
        DatabaseService,
        RENT_AGREEMENT_ANALYTICS_TOKEN
      ]
    },

    // ─── e-Stamping (Phase 15) ──────────────────────────────────────────────
    {
      provide: RENT_AGREEMENT_ESTAMP_PROVIDER,
      useFactory: (): EStampingProvider => new MockEStampingProvider()
      // PROD: swap to new SHCILEStampingProvider({apiKey, ...}) — see PRODUCTION-WIRING.md
    },
    {
      provide: EStampingService,
      useFactory: (drafts: DraftsService, provider: EStampingProvider) =>
        new EStampingService({ drafts, provider }),
      inject: [DraftsService, RENT_AGREEMENT_ESTAMP_PROVIDER]
    },

    // ─── Aadhaar eSign (Phase 15) ───────────────────────────────────────────
    {
      provide: RENT_AGREEMENT_ESIGN_PROVIDER,
      useFactory: (): ESignProvider => new MockESignProvider()
      // PROD: swap to new ProteanESignProvider({auaCode, licenseKey, ...})
    },
    {
      provide: ESignService,
      useFactory: (drafts: DraftsService, provider: ESignProvider) =>
        new ESignService({ drafts, provider }),
      inject: [DraftsService, RENT_AGREEMENT_ESIGN_PROVIDER]
    },

    // ─── Downloads ──────────────────────────────────────────────────────────
    {
      provide: DownloadsService,
      useFactory: (drafts: DraftsService, sasIssuer: SasIssuerPort, db: DatabaseService) =>
        new DownloadsService({
          sasIssuer,
          loadAgreementForDownload: makeDraftsAgreementLoader(drafts),
          incrementDownloadCount: makeDraftsCounterIncrementer(drafts),
          recordDownloadAudit: db.isEnabled()
            ? makeDbDownloadAuditRecorder(db)
            : makeNoopAuditRecorder(),
          ipSalt: process.env.RENT_AGREEMENT_IP_SALT ?? "phase13-dev-salt"
        }),
      inject: [DraftsService, RENT_AGREEMENT_SAS_ISSUER, DatabaseService]
    },

    // ─── PDF preview (in-page viewer — streams bytes, no download counter) ───
    {
      provide: PdfPreviewService,
      useFactory: (drafts: DraftsService, pdfStorage: PdfStoragePort) =>
        new PdfPreviewService({
          loadAgreement: makeDraftsAgreementLoader(drafts),
          loadPdfBytes: async (blobPath) => (await pdfStorage.download(blobPath)) ?? undefined
        }),
      inject: [DraftsService, RENT_AGREEMENT_PDF_STORAGE]
    }
  ],
  exports: [
    // Exported so the controller's @Optional() dev-pdf-bytes endpoint can stream
    // bytes from the same singleton storage that the worker uploads to.
    RENT_AGREEMENT_PDF_STORAGE,
    // Exported so AdminModule can issue admin PDF download links.
    RENT_AGREEMENT_SAS_ISSUER
  ]
})
export class RentAgreementModule {}
