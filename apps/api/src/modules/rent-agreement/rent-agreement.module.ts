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
    DraftsService,
    SignaturesService,

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
    PdfJobQueueService,
    {
      provide: RENT_AGREEMENT_PDF_RENDERER,
      // Real Puppeteer + Handlebars renderer (lazy: Chromium launches on first
      // render). Produces a genuine PDF so /_dev/pdf-bytes serves a real file.
      useFactory: (): PdfRendererPort => new LazyPuppeteerPdfRenderer()
    },
    {
      provide: RENT_AGREEMENT_PDF_STORAGE,
      useFactory: (): PdfStoragePort => new InMemoryPdfStorage()
      // PROD: swap to new AzurePdfStorage(process.env.AZURE_STORAGE_CONNECTION_STRING)
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
            return { row, signatures: signatures.listForAgreement(agreementId) };
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
        autoCapture: DevAutoCapturePipeline
      ) =>
        new CheckoutService({
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
          onOrderCreated: async (draftId, providerOrderId) => {
            await drafts.markPendingPayment(draftId, providerOrderId);
            if (isDevMode()) {
              // Fire-and-forget — pipeline awaits markPaid + enqueue, then schedules
              // the worker tick via setImmediate. The HTTP response returns first.
              autoCapture.trigger(draftId).catch(() => {
                // intentional: failures appear in queue.markFailed
              });
            }
          }
        }),
      inject: [
        DraftsService,
        SignaturesService,
        RENT_AGREEMENT_PAYMENT_PROVIDER,
        DevAutoCapturePipeline
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
      useFactory: (drafts: DraftsService) =>
        new DownloadsService({
          sasIssuer: new DevApiSasIssuer({
            baseUrl: process.env.RENT_AGREEMENT_DEV_BASE_URL ?? ""
          }),
          // PROD: swap to new AzureSasIssuer({connectionString, containerName})
          loadAgreementForDownload: makeDraftsAgreementLoader(drafts),
          incrementDownloadCount: makeDraftsCounterIncrementer(drafts),
          recordDownloadAudit: makeNoopAuditRecorder(),
          // PROD: swap recordDownloadAudit to a DB-backed writer per PRODUCTION-WIRING.md
          ipSalt: process.env.RENT_AGREEMENT_IP_SALT ?? "phase13-dev-salt"
        }),
      inject: [DraftsService]
    },

    // ─── PDF preview (in-page viewer — streams bytes, no download counter) ───
    {
      provide: PdfPreviewService,
      useFactory: (drafts: DraftsService, pdfStorage: { get?(p: string): Buffer | undefined }) =>
        new PdfPreviewService({
          loadAgreement: makeDraftsAgreementLoader(drafts),
          loadPdfBytes: (blobPath) =>
            typeof pdfStorage?.get === "function" ? pdfStorage.get(blobPath) : undefined
        }),
      inject: [DraftsService, RENT_AGREEMENT_PDF_STORAGE]
    }
  ],
  exports: [
    // Exported so the controller's @Optional() dev-pdf-bytes endpoint can stream
    // bytes from the same singleton storage that the worker uploads to.
    RENT_AGREEMENT_PDF_STORAGE
  ]
})
export class RentAgreementModule {}
